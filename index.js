const bodyParser = require("body-parser");
const express = require("express");
const request = require("request");
const path = require("path");
const cors = require("cors");

const Blockchain = require("./blockchain");
const PubSub = require("./app/pubsub");
const TransactionPool = require("./wallet/transaction-pool");
const Wallet = require("./wallet");
const TranasactionMiner = require("./app/transaction-miner");

const isDevelopment = process.env.ENV === "development";

const REDIS_URL = isDevelopment
  ? "redis://127.0.0.1:6379"
  : "redis://default:FR9q03asXmFmgANQt3sVylPReQOvIaxv@redis-11169.c239.us-east-1-2.ec2.cloud.redislabs.com:11169";

const DEFAULT_PORT = 3000;

const ROOT_NODE_ADDRESS = isDevelopment
  ? `http://localhost:${DEFAULT_PORT}`
  : "https://infinite-ridge-78058-8f102667ca6c.herokuapp.com";

const app = express();
const blockchain = new Blockchain();
const transactionPool = new TransactionPool();
const wallet = new Wallet();
const pubsub = new PubSub({ blockchain, transactionPool, wallet, redisUrl: REDIS_URL });
const tranasctionMiner = new TranasactionMiner({ blockchain, transactionPool, wallet, pubsub });

// setTimeout(() => {
//   pubsub.broadcastChain();
// }, 1000);

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "client/dist")));

app.get("/api/blocks", (req, res) => {
  res.json(blockchain.chain);
});

app.post("/api/mine", (req, res) => {
  const { data } = req.body;

  blockchain.addBlock({ data });

  pubsub.broadcastChain();

  res.redirect("/api/blocks");
});

app.post("/api/transact", (req, res) => {
  const { amount, recipient } = req.body;
  let transaction = transactionPool.existingTransaction({ inputAddress: wallet.publicKey });

  try {
    if (transaction) {
      transaction.update({ senderWallet: wallet, recipient, amount });
    } else {
      transaction = wallet.createTransaction({ recipient, amount, chain: blockchain.chain });
    }
  } catch (error) {
    return res.json({ type: "error", message: error.message });
  }

  transactionPool.setTransaction(transaction);
  pubsub.broadcastTransaction(transaction);

  console.log("transactionPool", transactionPool);

  res.json({ type: "success", transaction });
});

app.get("/api/transaction-pool-map", (req, res) => {
  res.json(transactionPool.transactionMap);
});

app.get("/api/mine-transactions", (req, res) => {
  tranasctionMiner.mineTransactions();
  res.redirect("/api/blocks");
});

app.get("/api/wallet-info", (req, res) => {
  const address = wallet.publicKey;
  res.json({ address, balance: Wallet.calculateBalance({ chain: blockchain.chain, address }) });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "client/dist/index.html"));
});

const syncWithRootState = () => {
  request({ url: `${ROOT_NODE_ADDRESS}/api/blocks` }, (error, response, body) => {
    if (!error && response.statusCode === 200) {
      const rootChain = JSON.parse(body);

      console.log("replace chain on a sync with", rootChain);
      blockchain.replaceChain(rootChain);
    }
  });
  request({ url: `${ROOT_NODE_ADDRESS}/api/transaction-pool-map` }, (error, response, body) => {
    if (!error && response.statusCode === 200) {
      const rootTransactionPoolMap = JSON.parse(body);
      console.log("replace transaction pool map on a sync with", rootTransactionPoolMap);
      transactionPool.setMap(rootTransactionPoolMap);
    }
  });
};

if (isDevelopment) {
  const walletTest1 = new Wallet();
  const walletTest2 = new Wallet();

  const generateWalletTransaction = ({ wallet, recipient, amount }) => {
    const transaction = wallet.createTransaction({ recipient, amount, chain: blockchain.chain });
    transactionPool.setTransaction(transaction);
  };

  const walletAction1 = () => generateWalletTransaction({ wallet, recipient: walletTest1.publicKey, amount: 5 });
  const walletAction2 = () =>
    generateWalletTransaction({ wallet: walletTest1, recipient: walletTest2.publicKey, amount: 10 });
  const walletAction3 = () =>
    generateWalletTransaction({ wallet: walletTest2, recipient: wallet.publicKey, amount: 15 });

  for (let i = 0; i < 10; i++) {
    if (i % 3 === 0) {
      walletAction1();
      walletAction2();
    } else if (i % 3 === 1) {
      walletAction1();
      walletAction3();
    } else {
      walletAction2();
      walletAction3();
    }
    tranasctionMiner.mineTransactions();
  }
}

let PEER_PORT;

if (process.env.GENERATE_PEER_PORT === "true") {
  PEER_PORT = DEFAULT_PORT + Math.ceil(Math.random() * 1000);
}
const PORT = process.env.PORT || PEER_PORT || DEFAULT_PORT;
app.listen(PORT, () => {
  console.log(`listening at localhost:${PORT}`);
  if (PORT !== DEFAULT_PORT) {
    syncWithRootState();
  }
});
