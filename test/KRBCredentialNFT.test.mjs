import pkg from "hardhat";
const { ethers, upgrades } = pkg;
import { expect } from "chai";

import {
  EIP712VC,
  DEFAULT_CONTEXT,
  EIP712_CONTEXT,
  DEFAULT_VC_TYPE,
  getKrebitCredentialTypes,
  getEIP712Credential,
} from "@krebitdao/eip712-vc";

describe("KRBCredentialNFT", function () {
  before(async function () {
    this.accounts = await ethers.provider.listAccounts();

    this.KRBToken = await ethers.getContractFactory("KRBToken");
    this.krbToken = await upgrades.deployProxy(
      this.KRBToken,
      ["Krebit", "rKRB", "0.1"],
      {
        kind: "uups",
      }
    );
    await this.krbToken.deployed();

    this.KRBCredentialNFT = await ethers.getContractFactory("KRBCredentialNFT");
    console.log("Deploying KRBCredentialNFT...");
    this.krbNFT = await this.KRBCredentialNFT.deploy(
      "KRBCredentialNFT",
      "krbNFT",
      "ipfs://QmS66LWcinekhXibiiZwJvtHNuCHxzZvedneQDZW1ximPJ/",
      "ipfs:///QmS66LWcinekhXibiiZwJvtHNuCHxzZvedneQDZW1ximPJ/contract.json",
      100 * 10 ** 12,
      this.krbToken.address,
      "olderThan",
      "21"
    );
    await this.krbNFT.deployed();
    console.log("KRBCredentialNFT deployed to:", this.krbNFT.address);

    //accounts[1] is the VC Issuer
    this.issuer = ethers.provider.getSigner(this.accounts[1]);
    const KRBTokenIssuer = await ethers.getContractFactory(
      "KRBToken",
      this.issuer
    );
    this.krbTokenIssuer = await KRBTokenIssuer.attach(this.krbToken.address);

    //accounts[2] is the VC Credential Subject (user)
    this.subject = ethers.provider.getSigner(this.accounts[2]);
    const KRBTokenSubject = await ethers.getContractFactory(
      "KRBToken",
      this.subject
    );
    this.krbTokenSubject = await KRBTokenSubject.attach(this.krbToken.address);

    this.domain = {
      name: "Krebit",
      version: "0.1",
      chainId: await this.issuer.getChainId(),
      verifyingContract: this.krbToken.address,
    };

    // The data to sign
    let issuanceDate = Date.now();
    let expirationDate = new Date();
    expirationDate.setFullYear(expirationDate.getFullYear() + 3);

    let credential = {
      "@context": [DEFAULT_CONTEXT, EIP712_CONTEXT],
      type: [DEFAULT_VC_TYPE, "olderThan"],
      id: "https://example.org/person/1234",
      issuer: {
        id: "did:issuer",
        ethereumAddress: this.accounts[1],
      },
      credentialSubject: {
        id: "did:user",
        ethereumAddress: this.accounts[2],
        type: "olderThan",
        value: '{"value":"21","evidence":""}',
        typeSchema: "ceramic://def",
        encrypted: "null",
        trust: 50,
        stake: 6,
        price: ethers.utils.parseEther("0.0002").toString(),
        nbf: Math.floor(issuanceDate / 1000),
        exp: Math.floor(expirationDate.getTime() / 1000),
      },
      credentialSchema: {
        id: "https://krebit.id/schemas/v1",
        type: "Eip712SchemaValidator2021",
      },
      issuanceDate: new Date(issuanceDate).toISOString(),
      expirationDate: new Date(expirationDate).toISOString(),
    };

    this.eip712credential = getEIP712Credential(credential);
  });
  it("symbol", async function () {
    expect(await this.krbNFT.symbol()).to.equal("krbNFT");
  });

  it("mints KRB to Issuer", async function () {
    await this.krbToken.mint(this.accounts[1], (200 * 10 ** 18).toString());
    expect((await this.krbToken.totalSupply()).toString()).to.equal(
      (200 * 10 ** 18).toString() // 200 KRB
    );
  });

  it("price to mint", async function () {
    expect(await this.krbNFT.price()).to.equal(
      ethers.utils.parseEther("0.0001").toString()
    );
  });

  it("contractURI", async function () {
    expect(await this.krbNFT.contractURI()).to.equal(
      "ipfs:///QmS66LWcinekhXibiiZwJvtHNuCHxzZvedneQDZW1ximPJ/contract.json"
    );
  });

  it("update price to mint to 0.001 eth", async function () {
    await expect(
      this.krbNFT.setPrice(ethers.utils.parseEther("0.0002").toString())
    ).to.emit(this.krbNFT, "Updated");
    expect(await this.krbNFT.price()).to.equal(
      ethers.utils.parseEther("0.0002").toString()
    );
  });

  it("registerVC with eip712-vc", async function () {
    // The data to sign
    let issuanceDate = Date.now();
    let expirationDate = new Date();
    expirationDate.setFullYear(expirationDate.getFullYear() + 3);

    //console.log("eip712credential:", eip712credential);

    let krebitTypes = getKrebitCredentialTypes();

    let eip712vc = new EIP712VC(this.domain);

    const vc = await eip712vc.createEIP712VerifiableCredential(
      this.eip712credential,
      krebitTypes,
      async (data) => {
        return await this.issuer._signTypedData(
          this.domain,
          krebitTypes,
          this.eip712credential
        );
      }
    );

    //console.log(vc);

    //Issue
    await expect(
      this.krbTokenSubject.registerVC(
        this.eip712credential,
        vc.proof.proofValue,
        {
          value: ethers.utils.parseEther("0.0002").toString(),
        }
      )
    ).to.emit(this.krbToken, "Issued");
    expect(await this.krbToken.getVCStatus(this.eip712credential)).to.equal(
      "Issued"
    );
    expect(
      (await this.krbToken.balanceOf(this.accounts[2])).toString()
    ).to.equal((3 * 10 ** 18).toString()); // 3 KRB
    expect(
      (await this.krbToken.balanceOf(this.accounts[1])).toString()
    ).to.equal((197 * 10 ** 18).toString()); // 197 KRB
    expect((await this.krbToken.stakeOf(this.accounts[1])).toString()).to.equal(
      (6 * 10 ** 18).toString()
    ); // 6 KRB
  });

  it("tokenId not minted yet", async function () {
    await expect(this.krbNFT.ownerOf(1)).to.be.revertedWith(
      "ERC721: invalid token ID"
    );
  });

  it("mints emits Transfer", async function () {
    await expect(
      this.krbNFT.mintWithCredential(
        this.accounts[2],
        1,
        this.eip712credential,
        {
          value: ethers.utils.parseEther("0.0002").toString(),
        }
      )
    )
      .to.emit(this.krbNFT, "Transfer")
      .withArgs(
        ethers.constants.AddressZero,
        this.accounts[2],
        (1).toString() // TokenId = 1
      );
  });
});
