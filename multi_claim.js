// создаем файл keys.json в директории скрипта и вставляем свои приватные ключи
// скрипт автоматически клеймит все доступные кредиты на соответствующих ключах

const axios = require("axios");
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const keysPath = path.join(process.cwd(), "keys.json");
const WALLETS = JSON.parse(fs.readFileSync(keysPath, "utf8"));

const RPC_URL = "https://base-mainnet.infura.io/v3/*код_API_вставить*";
const CONTRACT_ADDRESS = "0x1A07595aF2FD14C495096ef5E50616D5Ea09B36D";
const CONTRACT_ABI = [
  "function redeem(string memory orderId, uint256 amount, uint256 timestamp, bytes memory signature) external"
];
const BASE_URL = "https://api.gaianet.ai/api/v1";

function showWallets() {
  console.log("Найдены кошельки в keys.json:");
  WALLETS.forEach((pk, i) => {
    const address = new ethers.Wallet(pk).address;
    console.log(`${i + 1}. ${address}`);
  });
}

function waitForEnter() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question("", () => {
      rl.close();
      resolve();
    });
  });
}

async function connectWallet(privateKey) {
  const userWallet = new ethers.Wallet(privateKey);
  const walletAddress = userWallet.address;
  const timestamp = Math.floor(Date.now() / 1000);
  const messageObj = { wallet_address: walletAddress, timestamp };

  const signature = await userWallet.signMessage(JSON.stringify(messageObj));

  const body = {
    message: messageObj,
    wallet_address: walletAddress,
    timestamp,
    signature,
  };

  const resp = await axios.post(`${BASE_URL}/users/connect-wallet/`, body, {
    headers: { "Content-Type": "application/json" },
  });

  if (resp.data.code !== 0) {
    throw new Error(`[connectWallet] Ошибка сервера: ${resp.data.msg}`);
  }
  return resp.data.data.access_token;
}

async function getPointsRedeemable(accessToken) {
  const resp = await axios.get(`${BASE_URL}/reward/points-redeem/preview/`, {
    headers: { Authorization: accessToken },
  });
  if (resp.data.code !== 0) {
    throw new Error(`[getPointsRedeemable] Ошибка сервера: ${resp.data.msg}`);
  }
  return resp.data.data;
}

async function createRedeemOrder(accessToken, pointsToRedeem) {
  const body = { points_to_redeem: pointsToRedeem };
  const headers = {
    "Content-Type": "application/json",
    Authorization: accessToken,
  };
  const resp = await axios.post(`${BASE_URL}/credit/create-redeem-order/`, body, { headers });
  if (resp.data.code !== 0) {
    throw new Error(`[createRedeemOrder] Ошибка сервера: ${resp.data.msg}`);
  }
  return resp.data.data;
}

async function redeemOnContract(privateKey, orderId, amount, timestamp, signature) {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const userWallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, userWallet);

  const tx = await contract.redeem(orderId, amount, timestamp, signature);
  const receipt = await tx.wait();
  return { txHash: tx.hash, block: receipt.blockNumber, status: receipt.status };
}

async function claimForWallet(privateKey, index, total) {
  const walletAddress = new ethers.Wallet(privateKey).address;
  console.log(`\n[${index + 1}/${total}] Кошелёк: ${walletAddress}`);

  const accessToken = await connectWallet(privateKey);
  console.log("   ✓ Кошелёк подключён, токен получен.");

  const pointsData = await getPointsRedeemable(accessToken);
  const pointsToRedeem = pointsData.today_redeemable_points;
  console.log(`   Доступные поинты: ${pointsToRedeem} (клеймим столько же).`);

  const orderData = await createRedeemOrder(accessToken, pointsToRedeem);
  console.log(`   ✓ Ордер создан. ID: ${orderData.id}`);

  const { id, credits_amount_scaled, timestamp, signature } = orderData;
  const result = await redeemOnContract(privateKey, id, credits_amount_scaled, timestamp, signature);

  const statusStr = (result.status === 1) ? "SUCCESS" : "FAIL";
  console.log(`   ✓ Tx: ${result.txHash}, block: ${result.block}, status: ${statusStr}`);
}

async function main() {
  showWallets();
  console.log("\nНажмите Enter, чтобы начать выполнение скрипта или закройте окно для отмены...");
  await waitForEnter();

  console.log(`\n[main] Начинаем клейм для ${WALLETS.length} кошельков...`);
  for (let i = 0; i < WALLETS.length; i++) {
    const pk = WALLETS[i];
    try {
      await claimForWallet(pk, i, WALLETS.length);
    } catch (err) {
      if (err.response) {
        console.error(`Ошибка от сервера (код ${err.response.data.code}): ${err.response.data.msg}`);
      } else {
        console.error("Ошибка:", err.message);
      }
    }
  }

  console.log("\nAll done!");
  console.log("Нажмите Enter, чтобы закрыть окно...");
  await waitForEnter();
}

main();
