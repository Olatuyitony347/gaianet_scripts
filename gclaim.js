const axios = require("axios");
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const SCRIPT_INTERVAL_MINUTES = 720; // Set interval in minutes for script restart

const keysPath = path.join(process.cwd(), "keys.json");
const WALLETS = JSON.parse(fs.readFileSync(keysPath, "utf8"));

const RPC_URL = "https://base-mainnet.g.alchemy.com/v2/irCKY81naH96CYDupXi1SM9TGRrOq-Ob";
const CONTRACT_ADDRESS = "0x1A07595aF2FD14C495096ef5E50616D5Ea09B36D";
const CONTRACT_ABI = [
  "function redeem(string memory orderId, uint256 amount, uint256 timestamp, bytes memory signature) external"
];
const BASE_URL = "https://api.gaianet.ai/api/v1";

function showWallets() {
  console.log("Wallets found in keys.json:");
  WALLETS.forEach((pk, i) => {
    const address = new ethers.Wallet(pk).address;
    console.log(`${i + 1}. ${address}`);
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
    throw new Error(`[connectWallet] Server error: ${resp.data.msg}`);
  }
  return resp.data.data.access_token;
}

async function getPointsRedeemable(accessToken) {
  const resp = await axios.get(`${BASE_URL}/reward/points-redeem/preview/`, {
    headers: { Authorization: accessToken },
  });
  if (resp.data.code !== 0) {
    throw new Error(`[getPointsRedeemable] Server error: ${resp.data.msg}`);
  }
  return resp.data.data;
}

// Function to check if wallet should be skipped
async function shouldSkipWallet(privateKey) {
  try {
    const accessToken = await connectWallet(privateKey);
    const pointsData = await getPointsRedeemable(accessToken);
    const pointsToRedeem = pointsData.today_redeemable_points;

    if (pointsToRedeem === 0) {
      console.log(`   ⚠ No claimable points. Skipping this wallet.`);
      return true; // Wallet should be skipped
    }
    return false; // Wallet has points, proceed with claiming
  } catch (error) {
    console.error("   ⚠ Error checking claimable points:", error.message);
    return true; // Skip wallet on error to prevent script crashes
  }
}

async function createRedeemOrder(accessToken, pointsToRedeem) {
  const body = { points_to_redeem: pointsToRedeem };
  const headers = {
    "Content-Type": "application/json",
    Authorization: accessToken,
  };
  const resp = await axios.post(`${BASE_URL}/credit/create-redeem-order/`, body, { headers });
  if (resp.data.code !== 0) {
    throw new Error(`[createRedeemOrder] Server error: ${resp.data.msg}`);
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
  console.log(`\n[${index + 1}/${total}] Wallet: ${walletAddress}`);

  // Check if wallet should be skipped
  const skip = await shouldSkipWallet(privateKey);
  if (skip) return;

  const accessToken = await connectWallet(privateKey);
  console.log("   ✓ Wallet connected, token received.");

  const pointsData = await getPointsRedeemable(accessToken);
  const pointsToRedeem = pointsData.today_redeemable_points;
  console.log(`   Available points: ${pointsToRedeem} (claiming the same amount).`);

  const orderData = await createRedeemOrder(accessToken, pointsToRedeem);
  console.log(`   ✓ Order created. ID: ${orderData.id}`);

  const { id, credits_amount_scaled, timestamp, signature } = orderData;
  const result = await redeemOnContract(privateKey, id, credits_amount_scaled, timestamp, signature);

  const statusStr = (result.status === 1) ? "SUCCESS" : "FAIL";
  console.log(`   ✓ Tx: ${result.txHash}, block: ${result.block}, status: ${statusStr}`);
}

// Function to restart script at intervals
async function mainLoop() {
  while (true) {
    console.log(`\n[main] Starting claim process for ${WALLETS.length} wallets...`);
    for (let i = 0; i < WALLETS.length; i++) {
      const pk = WALLETS[i];
      try {
        await claimForWallet(pk, i, WALLETS.length);
      } catch (err) {
        if (err.response) {
          console.error(`Server error (code ${err.response.data.code}): ${err.response.data.msg}`);
        } else {
          console.error("Error:", err.message);
        }
      }
    }

    console.log(`\nAll done! Restarting in ${SCRIPT_INTERVAL_MINUTES} minutes...`);
    await new Promise(resolve => setTimeout(resolve, SCRIPT_INTERVAL_MINUTES * 60 * 1000));
  }
}

// Start the script with an interval loop
mainLoop();
