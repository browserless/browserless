#!/bin/bash
prefix=puppeteer-

for branch in `git branch --list 'puppeteer-*'`;
do
  puppeteer_version=${branch#$prefix}
  git checkout $branch
  git merge master
  npm i --save puppeteer@$puppeteer_version
  git push origin $branch
done
