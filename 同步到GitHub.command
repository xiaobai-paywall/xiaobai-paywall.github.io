#!/bin/zsh
# 双击运行：把 素材/ 里的图片和标签数据提交并推送到 GitHub，约 1 分钟后网页更新
cd "${0:A:h}" || exit 1

finish() { echo; read -k 1 "?按任意键关闭…"; exit $1; }

echo "== 同步订阅页图库到 GitHub =="
pics=$(ls 订阅页图库/素材 2>/dev/null | grep -civE '^(data\.js|\.gitkeep)$')
echo "素材文件夹里有 $pics 张图片"
if [ "$pics" -eq 0 ] && [ ! -f 订阅页图库/素材/data.js ]; then
  echo "素材文件夹是空的：请先在图库右上角点「备份到素材文件夹」，选择 订阅页图库/素材"
fi

git add -A
if git diff --cached --quiet; then
  echo "没有新的改动，无需同步"
  finish 0
fi

added=$(git diff --cached --name-only --diff-filter=A -- 订阅页图库/素材 | grep -cv 'data\.js$')
removed=$(git diff --cached --name-only --diff-filter=D -- 订阅页图库/素材 | grep -cv 'data\.js$')
if [ "$added" -eq 0 ] && [ "$removed" -eq 0 ]; then
  msg="更新图库"
else
  msg="更新素材：新增 $added 张，删除 $removed 张"
fi
git commit -qm "$msg（$(date '+%Y-%m-%d %H:%M')）" || finish 1
echo "$msg，正在推送…"

# 云端每天会自动提交扫描结果，推送前先合并
if ! git pull -q --rebase --autostash; then
  echo "✗ 拉取 GitHub 上的最新改动失败：请检查网络；如果提示冲突，把这个窗口的内容发给 AI 处理"
  finish 1
fi
if git push -q; then
  echo "✓ 已同步，约 1 分钟后网页更新：https://xiaobai-paywall.github.io"
  echo "仓库大小：$(du -sh .git | cut -f1)（超过 500MB 时可以让 AI 给仓库瘦身）"
  finish 0
else
  echo "✗ 推送失败：请检查网络，或在终端运行 gh auth status 确认 GitHub 已登录"
  finish 1
fi
