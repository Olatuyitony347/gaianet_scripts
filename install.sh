#!/bin/bash
set -e

sudo apt update && sudo apt upgrade -y

sudo apt install -y curl jq snapd screen
sudo apt install -y python3 python3-venv python3-pip 
sudo snap install btop

# Обновление pip и установка Python-зависимостей (для скрипта)
# python3 -m pip install --upgrade pip
# pip3 install requests psutil

# Количество нод для установки
NUM_NODES=2
BASE_DIR="$HOME"
INFO_FILE="gaianet_nodes_info.txt"

> "$INFO_FILE"

for ((i=1; i<=NUM_NODES; i++)); do
    NODE_DIR="$BASE_DIR/gaianet$i"
    PORT=$((8100 + i))

    echo "\nУстанавливаем ноду #$i в $NODE_DIR с портом $PORT..."
    mkdir -p "$NODE_DIR"
    
    curl -sSfL 'https://github.com/GaiaNet-AI/gaianet-node/releases/latest/download/install.sh' | bash -s -- --base "$NODE_DIR"

    export PATH="$PATH:$NODE_DIR/bin"
    
    gaianet init --config https://raw.githubusercontent.com/GaiaNet-AI/node-configs/main/qwen2-0.5b-instruct/config.json --base "$NODE_DIR"

    gaianet config --base "$NODE_DIR" --port "$PORT"

    gaianet init --base "$NODE_DIR"

    sudo lsof -t -i:"$PORT" | xargs -r sudo kill -9

    gaianet start --base "$NODE_DIR"

    RAW_INFO=$(gaianet info --base "$NODE_DIR")

    CLEAN_INFO=$(echo "$RAW_INFO" | sed -E "s/\x1B\[[0-9;]*m//g")

    NODE_ID=$(echo "$CLEAN_INFO" | grep "Node ID")
    DEVICE_ID=$(echo "$CLEAN_INFO" | grep "Device ID")

    NODE_VALUE=$(echo "$NODE_ID" | sed -E 's/^Node ID:\s*//')
    DEVICE_VALUE=$(echo "$DEVICE_ID" | sed -E 's/^Device ID:\s*//')
    
    {
      echo "Node #$i"       
      echo "$NODE_VALUE"    
      echo "$DEVICE_VALUE"  
      echo
    } >> "$INFO_FILE"

    
    sleep 1 
done

echo "\nУстановка всех $NUM_NODES нод завершена. Данные о нодах сохранены в $INFO_FILE"
