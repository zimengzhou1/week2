const hre = require("hardhat");
const { ethers, waffle } = hre;
const { loadFixture } = waffle;
const { expect } = require("chai");
const { utils } = ethers;

const Utxo = require("../src/utxo");
const {
  transaction,
  registerAndTransact,
  prepareTransaction,
  buildMerkleTree,
} = require("../src/index");
const { toFixedHex, poseidonHash } = require("../src/utils");
const { Keypair } = require("../src/keypair");
const { encodeDataForBridge } = require("./utils");

const MERKLE_TREE_HEIGHT = 5;
const l1ChainId = 1;
const MINIMUM_WITHDRAWAL_AMOUNT = utils.parseEther(
  process.env.MINIMUM_WITHDRAWAL_AMOUNT || "0.05"
);
const MAXIMUM_DEPOSIT_AMOUNT = utils.parseEther(
  process.env.MAXIMUM_DEPOSIT_AMOUNT || "1"
);

describe("Custom Tests", function () {
  this.timeout(20000);

  async function deploy(contractName, ...args) {
    const Factory = await ethers.getContractFactory(contractName);
    const instance = await Factory.deploy(...args);
    return instance.deployed();
  }

  async function fixture() {
    require("../scripts/compileHasher");
    const [sender, gov, l1Unwrapper, multisig] = await ethers.getSigners();
    const verifier2 = await deploy("Verifier2");
    const verifier16 = await deploy("Verifier16");
    const hasher = await deploy("Hasher");

    const token = await deploy(
      "PermittableToken",
      "Wrapped ETH",
      "WETH",
      18,
      l1ChainId
    );
    await token.mint(sender.address, utils.parseEther("10000"));

    const amb = await deploy("MockAMB", gov.address, l1ChainId);
    const omniBridge = await deploy("MockOmniBridge", amb.address);

    /** @type {TornadoPool} */
    const tornadoPoolImpl = await deploy(
      "TornadoPool",
      verifier2.address,
      verifier16.address,
      MERKLE_TREE_HEIGHT,
      hasher.address,
      token.address,
      omniBridge.address,
      l1Unwrapper.address,
      gov.address,
      l1ChainId,
      multisig.address
    );

    const { data } = await tornadoPoolImpl.populateTransaction.initialize(
      MINIMUM_WITHDRAWAL_AMOUNT,
      MAXIMUM_DEPOSIT_AMOUNT
    );
    const proxy = await deploy(
      "CrossChainUpgradeableProxy",
      tornadoPoolImpl.address,
      gov.address,
      data,
      amb.address,
      l1ChainId
    );

    const tornadoPool = tornadoPoolImpl.attach(proxy.address);

    await token.approve(tornadoPool.address, utils.parseEther("10000"));

    return { tornadoPool, token, proxy, omniBridge, amb, gov, multisig };
  }

  async function getBalance(tornadoPool, keypair) {
    const filter = tornadoPool.filters.NewCommitment();
    const fromBlock = await ethers.provider.getBlock();
    const events = await tornadoPool.queryFilter(filter, fromBlock.number);
    let receiveUtxo;
    try {
      receiveUtxo = Utxo.decrypt(
        keypair,
        events[0].args.encryptedOutput,
        events[0].args.index
      );
    } catch (e) {
      // we try to decrypt another output here because it shuffles outputs before sending to blockchain
      receiveUtxo = Utxo.decrypt(
        keypair,
        events[1].args.encryptedOutput,
        events[1].args.index
      );
    }
    return receiveUtxo.amount;
  }

  it("[assignment] ii. deposit 0.1 ETH in L1 -> withdraw 0.08 ETH in L2 -> assert balances", async () => {
    // [assignment] complete code here
    const { tornadoPool, token, omniBridge } = await loadFixture(fixture);

    // Store keypairs
    const aliceKeypair = new Keypair();

    // Alice deposits 0.1 ETH in L1
    const depositAmount = utils.parseEther("0.1");
    const depositUtxo = new Utxo({
      amount: depositAmount,
      keypair: aliceKeypair,
    });

    const { args, extData } = await prepareTransaction({
      tornadoPool,
      outputs: [depositUtxo],
    });

    const onTokenBridgedData = encodeDataForBridge({
      proof: args,
      extData,
    });

    const onTokenBridgedTx =
      await tornadoPool.populateTransaction.onTokenBridged(
        token.address,
        depositUtxo.amount,
        onTokenBridgedData
      );

    // emulating bridge. first it sends tokens to omnibridge mock then it sends to the pool
    await token.transfer(omniBridge.address, depositAmount);
    const transferTx = await token.populateTransaction.transfer(
      tornadoPool.address,
      depositAmount
    );

    await omniBridge.execute([
      { who: token.address, callData: transferTx.data }, // send tokens to pool
      { who: tornadoPool.address, callData: onTokenBridgedTx.data }, // call onTokenBridgedTx
    ]);

    // withdraws a part of his funds from the shielded pool
    const withdrawAmount = utils.parseEther("0.08");
    const recipient = "0xDeaD00000000000000000000000000000000BEEf";
    const aliceChangeUtxo = new Utxo({
      amount: depositAmount.sub(withdrawAmount),
      keypair: aliceKeypair,
    });

    await transaction({
      tornadoPool,
      inputs: [depositUtxo],
      outputs: [aliceChangeUtxo],
      recipient: recipient,
      isL1Withdrawal: false,
    });

    const recipientBalance = await token.balanceOf(recipient);
    expect(recipientBalance).to.be.equal(withdrawAmount);

    const bridgeBalance = await token.balanceOf(omniBridge.address);
    expect(bridgeBalance).to.be.equal(0);

    const tornadoPoolBalance = await token.balanceOf(tornadoPool.address);
    expect(tornadoPoolBalance).to.be.equal(utils.parseEther("0.02"));
  });

  it("[assignment] iii. see assignment doc for details", async () => {
    // [assignment] complete code here
    const { tornadoPool, token, omniBridge } = await loadFixture(fixture);

    // Store keypairs
    const aliceKeypair = new Keypair();

    // Alice deposits 0.13 ETH in L1
    const depositAmount = utils.parseEther("0.13");
    const depositUtxo = new Utxo({
      amount: depositAmount,
      keypair: aliceKeypair,
    });

    const { args, extData } = await prepareTransaction({
      tornadoPool,
      outputs: [depositUtxo],
    });

    const onTokenBridgedData = encodeDataForBridge({
      proof: args,
      extData,
    });

    const onTokenBridgedTx =
      await tornadoPool.populateTransaction.onTokenBridged(
        token.address,
        depositUtxo.amount,
        onTokenBridgedData
      );

    await token.transfer(omniBridge.address, depositAmount);
    const transferTx = await token.populateTransaction.transfer(
      tornadoPool.address,
      depositAmount
    );

    await omniBridge.execute([
      { who: token.address, callData: transferTx.data },
      { who: tornadoPool.address, callData: onTokenBridgedTx.data },
    ]);

    expect(await getBalance(tornadoPool, aliceKeypair)).to.be.equal(
      depositAmount
    );

    //--------------------------------------------------------------------------------------------------------

    // Bob gives Alice address to send some eth inside the shielded pool
    const bobKeypair = new Keypair();
    const bobAddress = bobKeypair.address();

    // Alice sends some funds to Bob
    const bobSendAmount = utils.parseEther("0.06");
    const bobSendUtxo = new Utxo({
      amount: bobSendAmount,
      keypair: Keypair.fromString(bobAddress),
    });
    const aliceChangeUtxo = new Utxo({
      amount: depositAmount.sub(bobSendAmount),
      keypair: depositUtxo.keypair,
    });
    await transaction({
      tornadoPool,
      inputs: [depositUtxo],
      outputs: [bobSendUtxo, aliceChangeUtxo],
    });

    expect(await getBalance(tornadoPool, bobKeypair)).to.be.equal(
      bobSendAmount
    );

    expect(await getBalance(tornadoPool, aliceKeypair)).to.be.equal(
      depositAmount.sub(bobSendAmount)
    );

    // ---------------------------------------------------------------------------------------------------------
    const filter = tornadoPool.filters.NewCommitment();
    const fromBlock = await ethers.provider.getBlock();
    const events = await tornadoPool.queryFilter(filter, fromBlock.number);
    let bobReceiveUtxo;
    try {
      bobReceiveUtxo = Utxo.decrypt(
        bobKeypair,
        events[0].args.encryptedOutput,
        events[0].args.index
      );
    } catch (e) {
      bobReceiveUtxo = Utxo.decrypt(
        bobKeypair,
        events[1].args.encryptedOutput,
        events[1].args.index
      );
    }
    // Bob withdraws all of his funds from the shielded pool
    const bobWithdrawAmount = utils.parseEther("0.06");
    const bobEthAddress = "0xDeaD00000000000000000000000000000000BEEf";
    const bobChangeUtxo = new Utxo({
      amount: bobSendAmount.sub(bobWithdrawAmount),
      keypair: bobKeypair,
    });
    await transaction({
      tornadoPool,
      inputs: [bobReceiveUtxo],
      outputs: [bobChangeUtxo],
      recipient: bobEthAddress,
    });

    const bobBalance = await token.balanceOf(bobEthAddress);
    expect(bobBalance).to.be.equal(bobWithdrawAmount);

    // ------------------------------------------------------------------------------------------------------------
    const aliceETHWithdraw = depositAmount.sub(bobSendAmount);
    const aliceUTXOWithdraw = new Utxo({
      amount: aliceETHWithdraw,
      keypair: aliceKeypair,
    });
    await transaction({
      tornadoPool,
      inputs: [aliceChangeUtxo],
      outputs: [aliceUTXOWithdraw],
      isL1Withdrawal: true,
    });
    expect(await getBalance(tornadoPool, aliceKeypair)).to.be.equal(
      aliceETHWithdraw
    );
  });
});
