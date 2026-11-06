#!/bin/zsh
# 每日定时任务调用：扫描并更新 数据/latest.js，日志按月写入 logs/
cd "${0:A:h}" || exit 1
mkdir -p logs
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 scout.py >> "logs/$(date +%Y-%m).log" 2>&1
