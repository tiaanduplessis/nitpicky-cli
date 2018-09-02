#!/usr/bin/env node

const child = require('child_process')
const path = require('path')
const fs = require('fs')

const eslintPkgLoc = require.resolve('eslint/package.json')
const bin = require(eslintPkgLoc).bin // eslint-disable-line

const entry = process.argv.length > 2 ? process.argv[2] : '.'

const cmds = [
  {
    name: 'node',
    args: [path.resolve(path.join(eslintPkgLoc, '..', bin.eslint || bin)), '--parser', 'babel-eslint', '--config', require.resolve('eslint-config-nitpicky'), entry, '--fix'],
  },
]

if (fs.existsSync('.flowconfig')) {
  cmds.push({
    name: require('flow-bin'), // eslint-disable-line
    args: ['check'],
  })
}

let err = false
let remaining = cmds.length

function done() {
  if (err) {
    process.exit(1)
  } else {
    console.log('No probs! ✨\n')
    process.exit()
  }
}

function next() {
  if (!cmds.length) return

  const cmd = cmds.shift()
  const proc = child.spawn(cmd.name, cmd.args, { stdio: 'inherit' })

  proc.on('error', (_err) => {
    err = true
    console.error(_err.stack || _err.message || _err)
  })

  proc.on('close', (code) => {
    if (code !== 0) {
      err = true
    }

    remaining -= 1
    if (remaining) {
      next()
    } else {
      done()
    }
  })
}

next()
