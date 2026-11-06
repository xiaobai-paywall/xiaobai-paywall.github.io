#!/bin/zsh
# 每日定时任务调用：扫描并更新 数据/latest.js，日志按月写入 logs/
#   定时触发：今天已经成功跑过就直接退出（一天最多一次）
#   手动触发：run.sh --force，不受每日次数限制
# 任何情况下同一时间只跑一个，单次超过 MAX_SECONDS 强制结束
cd "${0:A:h}" || exit 1
mkdir -p logs
LOG="logs/$(date +%Y-%m).log"
STAMP="logs/.last_success"
LOCK="logs/.running"
MAX_SECONDS=1800
TODAY=$(date +%F)
say() { print "[$(date +%T)] $*" >> "$LOG"; }

if [[ "$1" != "--force" && "$(cat $STAMP 2>/dev/null)" == "$TODAY" ]]; then
  say "今天已经扫描过，跳过（手动强制运行：run.sh --force）"
  exit 0
fi

# 锁目录超过 MAX_SECONDS 还在，说明上次异常退出，视为失效
if ! mkdir "$LOCK" 2>/dev/null; then
  if [[ -n $(find "$LOCK" -maxdepth 0 -mmin +$((MAX_SECONDS / 60)) 2>/dev/null) ]]; then
    rm -rf "$LOCK" && mkdir "$LOCK" || exit 1
  else
    say "已有一次扫描在运行，跳过"
    exit 0
  fi
fi
trap 'rm -rf "$LOCK"' EXIT

/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 scout.py >> "$LOG" 2>&1 &
PID=$!
for (( i = 0; i < MAX_SECONDS; i += 5 )); do
  kill -0 $PID 2>/dev/null || break
  sleep 5
done
if kill -0 $PID 2>/dev/null; then
  kill $PID; sleep 5; kill -9 $PID 2>/dev/null
  say "运行超过 $((MAX_SECONDS / 60)) 分钟，已强制结束"
  exit 1
fi
wait $PID && print "$TODAY" > "$STAMP"
exit 0
