import requests
import random
import time
import logging
import psutil
import sys
import traceback
from concurrent.futures import ThreadPoolExecutor
from typing import List
import threading

BLUE = "\033[34m"
GREEN = "\033[32m"
RED = "\033[31m"
BOLD = "\033[1m"
RESET = "\033[0m"

GLOBAL_KEYS: List[str] = []
GLOBAL_INDEX = 0
GLOBAL_LOCK = threading.Lock()

def get_next_key() -> str:
    with GLOBAL_LOCK:
        if not GLOBAL_KEYS:
            return None
        global GLOBAL_INDEX
        key = GLOBAL_KEYS[GLOBAL_INDEX % len(GLOBAL_KEYS)]
        GLOBAL_INDEX += 1
        return key

def remove_key(key: str):
    with GLOBAL_LOCK:
        if key in GLOBAL_KEYS:
            GLOBAL_KEYS.remove(key)
        global GLOBAL_INDEX
        if GLOBAL_INDEX >= len(GLOBAL_KEYS):
            GLOBAL_INDEX = 0

def log_send(message: str):
    logging.info(f"{BOLD}{BLUE}-> {message}{RESET}")

def log_success(message: str):
    logging.info(f"{BOLD}{GREEN}✅ {message}{RESET}")

def log_error_short(message: str):
    logging.error(f"{BOLD}{RED}❌ ERROR - {message}{RESET}")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(message)s",  
    handlers=[
        logging.FileHandler("chatbot.log", encoding="utf-8"),
        logging.StreamHandler()
    ]
)

# вставляем ваш домен и меняем модель при необходимости
BASE_URL = "..."
MODEL = "qwen-2-0.5b-instruct"
QUESTION_DELAY = 8
CPU_THRESHOLD = 90
CPU_CHECK_INTERVAL = 10
REQUEST_TIMEOUT = 60

QUESTIONS = [
    "What is no-code?",
    "Why use no-code for websites?",
    "Which no-code tools are popular for websites?",
    "..."
]

class KeyExhaustedException(Exception):
    pass

def load_api_keys(filename: str = "keys.txt") -> List[str]:
    keys = []
    with open(filename, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            keys.append(line)
    if not keys:
        raise ValueError("Ключи не найдены в файле keys.txt")
    return keys

def parse_error_code(e: Exception) -> str:
    if isinstance(e, KeyExhaustedException):
        return "402"
    if isinstance(e, requests.exceptions.RequestException):
        return "NET"

    msg = str(e)
    if "API Error:" in msg:
        part = msg.split("API Error:")[1].strip() 
        code_part = part.split(",")[0]           
        return code_part
    return "???"

def chat_with_ai(api_key: str, question: str) -> None:
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    data = {
        "model": MODEL,
        "messages": [{"role": "user", "content": question}],
        "temperature": 0.7
    }
    response = requests.post(
        f"{BASE_URL}/v1/chat/completions",
        headers=headers,
        json=data,
        timeout=REQUEST_TIMEOUT
    )

    if response.status_code == 200:
        return
    elif response.status_code == 402 or "Insufficient gaiaCredits Balance" in response.text:
        raise KeyExhaustedException("Key exhausted (402)")
    else:
        raise Exception(f"API Error: {response.status_code}, response={response.text[:200]}")

def format_error_message(thread_id: int, code: str) -> str:
    if code.isdigit():
        return f"[Worker {thread_id}] - HTTP {code} Error"
    elif code == "NET":
        return f"[Worker {thread_id}] - Network Error"
    else:
        return f"[Worker {thread_id}] - {code} Error"

def worker_task(thread_id: int):
    initial_delay = random.uniform(0, QUESTION_DELAY)
    log_send(f"[Worker {thread_id}] initial delay: {initial_delay:.2f}s")
    time.sleep(initial_delay)

    rate_limit_errors = 0

    while True:

        cpu_load = psutil.cpu_percent(interval=1)
        if cpu_load > CPU_THRESHOLD:
            log_error_short(f"[Worker {thread_id}] - CPU Load={cpu_load}%")
            time.sleep(CPU_CHECK_INTERVAL)
            continue

        key = get_next_key()
        if not key:
            log_error_short(f"[Worker {thread_id}] - No keys left!")
            time.sleep(30)
            continue

        question = random.choice(QUESTIONS)
        log_send(f"[Worker {thread_id}] sending request...")
        start_time = time.time()

        try:
            chat_with_ai(key, question)
            elapsed = time.time() - start_time
            log_success(f"[Worker {thread_id}] response in {elapsed:.2f}s")
            rate_limit_errors = 0
            time.sleep(QUESTION_DELAY + random.uniform(0, 1))

        except KeyExhaustedException as e:
            code = parse_error_code(e)
            error_msg = format_error_message(thread_id, code)
            log_error_short(error_msg)
            remove_key(key)
            time.sleep(5)  

        except Exception as e:
            code = parse_error_code(e)
            if code == "429" or "Rate limit" in str(e):
                rate_limit_errors += 1
                BASE_BACKOFF = 2
                MAX_BACKOFF = 120
                backoff_delay = min(BASE_BACKOFF * (2 ** rate_limit_errors), MAX_BACKOFF)
                jitter = random.uniform(0, backoff_delay / 2)
                total_delay = backoff_delay + jitter

                log_error_short(
                    f"[Worker {thread_id}] - HTTP 429 Error - "
                    f"Rate limit error count: {rate_limit_errors}. "
                    f"Backing off for {total_delay:.2f}s"
                )
                time.sleep(total_delay)
            else:
                error_msg = format_error_message(thread_id, code)
                log_error_short(error_msg)
                rate_limit_errors = 0
                time.sleep(QUESTION_DELAY + random.uniform(0, 2))

# меняем число потоков при необходимости
def run_bot(api_keys: List[str], num_threads: int = 50):
    with GLOBAL_LOCK:
        GLOBAL_KEYS.clear()
        GLOBAL_KEYS.extend(api_keys)

    with ThreadPoolExecutor(max_workers=num_threads) as executor:
        for i in range(num_threads):
            executor.submit(worker_task, i)

def main():
    print("Запуск бота: GaiaAI Chatbot by capy")
    api_keys = load_api_keys("keys.txt")
    logging.info(f"{BOLD}Загружено {len(api_keys)} ключей из файла keys.txt{RESET}")
  # меняем число потоков при необходимости
    run_bot(api_keys, num_threads=50)

if __name__ == "__main__":
    main()
