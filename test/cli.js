const assert = require('assert')
const child = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

// An optional path lets the same tests exercise an unpacked npm package.
const cli = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.js'))
const source = fs.readFileSync(cli, 'utf8')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nitpicky-cli-'))
let count = 0

function remove(directory) {
  fs.readdirSync(directory).forEach((name) => {
    const entry = path.join(directory, name)
    if (fs.lstatSync(entry).isDirectory()) remove(entry)
    else fs.unlinkSync(entry)
  })
  fs.rmdirSync(directory)
}

function run(name, options) {
  const opts = options || {}
  const directory = path.join(root, name)
  const installation = path.join(directory, 'cli with spaces')
  const project = path.join(directory, 'project with spaces')
  const modules = path.join(installation, 'node_modules')
  fs.mkdirSync(directory)
  fs.mkdirSync(installation)
  fs.mkdirSync(project)
  fs.mkdirSync(modules)
  fs.mkdirSync(path.join(modules, 'eslint'))
  fs.mkdirSync(path.join(modules, 'eslint-config-nitpicky'))
  fs.writeFileSync(path.join(installation, 'index.js'), source)
  const eslint = path.join(modules, 'eslint', 'eslint.js')
  const config = path.join(modules, 'eslint-config-nitpicky', 'index.js')
  fs.writeFileSync(path.join(modules, 'eslint', 'package.json'), JSON.stringify({
    bin: opts.stringBin ? 'eslint.js' : { eslint: 'eslint.js' },
  }))
  fs.writeFileSync(config, 'module.exports = {}\n')

  // Both fixtures run as real child processes, without installing or invoking
  // ESLint/Flow, touching the checkout, or starting a Flow server.
  const log = path.join(project, 'calls.jsonl')
  function fixture(tool, status, signal) {
    return [
      "const fs = require('fs')",
      `fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({`,
      `  tool: ${JSON.stringify(tool)}, argv: process.argv.slice(1),`,
      '  cwd: process.cwd(), execPath: process.execPath,',
      "}) + '\\n')",
      `console.log('${tool} stdout')`,
      `console.error('${tool} stderr')`,
      signal ? "process.kill(process.pid, 'SIGTERM')" : `process.exit(${status || 0})`,
    ].join('\n')
  }
  fs.writeFileSync(eslint, fixture('eslint', opts.eslintStatus, opts.eslintSignal))

  if (opts.flow) {
    fs.writeFileSync(path.join(project, '.flowconfig'), '')
    fs.mkdirSync(path.join(modules, 'flow-bin'))
    // Node executes the local file named "check", so no platform-specific
    // shell script or downloaded Flow executable is needed.
    const flow = opts.missingFlow ? path.join(project, 'missing-flow') : process.execPath
    fs.writeFileSync(path.join(modules, 'flow-bin', 'index.js'), `module.exports = ${JSON.stringify(flow)}\n`)
    fs.writeFileSync(path.join(project, 'check'), fixture('flow', opts.flowStatus, opts.flowSignal))
  }

  const emptyPath = path.join(directory, 'empty-path')
  fs.mkdirSync(emptyPath)
  const env = Object.assign({}, process.env)
  // Remove case variants as Windows environment keys are case-insensitive.
  Object.keys(env).forEach((key) => {
    if (key.toUpperCase() === 'PATH') delete env[key]
  })
  env.PATH = opts.emptyPath ? emptyPath : path.dirname(process.execPath)
  const result = child.spawnSync(process.execPath,
    [path.join(installation, 'index.js')].concat(opts.args || []), {
      cwd: project, env, encoding: 'utf8', timeout: 10000,
    })
  assert.ifError(result.error)
  assert.strictEqual(result.signal, null, `${name}: CLI should finish normally`)
  assert.strictEqual(result.status, opts.failure ? 1 : 0, `${name}: ${result.stderr}`)
  const calls = fs.existsSync(log)
    ? fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : []
  assert.deepStrictEqual(calls.map(call => call.tool),
    opts.flow && !opts.missingFlow ? ['eslint', 'flow'] : ['eslint'], name)
  const target = opts.args && opts.args.length ? opts.args[0] : '.'
  assert.deepStrictEqual(calls[0].argv,
    [eslint, '--parser', 'babel-eslint', '--config', config, target, '--fix'], name)
  calls.forEach((call) => {
    assert.strictEqual(call.cwd, project, name)
    assert.strictEqual(call.execPath, process.execPath, name)
    assert(result.stdout.indexOf(`${call.tool} stdout`) !== -1, name)
    assert(result.stderr.indexOf(`${call.tool} stderr`) !== -1, name)
  })
  if (calls.length === 2) {
    assert.deepStrictEqual(calls[1].argv, [path.join(project, 'check')], name)
  }
  assert.strictEqual(result.stdout.indexOf('No probs!') !== -1, !opts.failure, name)
  if (opts.missingFlow) assert(/ENOENT/.test(result.stderr), result.stderr)
  assert(!fs.existsSync(path.join(project, 'unexpected')), name)
  count += 1
  console.log(`ok ${count} - ${name}`)
}

try {
  run('default target without Flow')
  run('target containing spaces', { args: ['src with spaces'] })
  run('only the first argument is forwarded', { args: ['first.js', 'second.js', '--quiet'] })
  run('an empty first argument is preserved', { args: [''] })
  run('shell characters stay literal', { args: ['src; touch unexpected'] })
  run('string ESLint bin', { stringBin: true })
  run('Node absent from PATH', { emptyPath: true })
  run('Flow succeeds after ESLint', { flow: true, emptyPath: true })
  run('ESLint failure is normalized', { eslintStatus: 2, failure: true })
  run('Flow still runs after ESLint failure', { flow: true, eslintStatus: 2, failure: true })
  run('Flow failure is normalized', { flow: true, flowStatus: 3, failure: true })
  run('both tools fail', { flow: true, eslintStatus: 2, flowStatus: 3, failure: true })
  run('ESLint signal still allows Flow', { flow: true, eslintSignal: true, failure: true })
  run('Flow signal fails the CLI', { flow: true, flowSignal: true, failure: true })
  run('Flow spawn error fails the CLI', { flow: true, missingFlow: true, failure: true })
  console.log(`1..${count}`)
} finally {
  remove(root)
}
