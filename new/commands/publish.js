const args = require('minimist')(process.argv.slice(2))
const axios = require('axios')
const path = require('path')
const globby = require('globby')
const AdmZip = require('adm-zip')
const { contains, isNil, last, split } = require('ramda')
const { tmpdir } = require('os')
const fs = require('fs')
const { getConfig } = require('../utils')

const pack = async (inputDirPath, outputFilePath, include = [], exclude = []) => {
  const format = last(split('.', outputFilePath))

  if (!contains(format, ['zip', 'tar'])) {
    throw new Error('Please provide a valid format. Either a "zip" or a "tar"')
  }

  const patterns = ['**']

  if (!isNil(exclude)) {
    exclude.forEach((excludedItem) => patterns.push(`!${excludedItem}`))
  }

  const zip = new AdmZip()

  const files = (await globby(patterns, { cwd: inputDirPath })).sort()

  files.map((file) => {
    if (file === path.basename(file)) {
      zip.addLocalFile(file)
    } else {
      zip.addLocalFile(file, file)
    }
  })

  if (!isNil(include)) {
    include.forEach((file) => zip.addLocalFile(file))
  }

  zip.writeZip(outputFilePath)

  return outputFilePath
}

const getComponentUploadUrl = async (serverlessComponentFile) => {
  const url = `https://y6w6rsjkib.execute-api.us-east-1.amazonaws.com/dev/component/${serverlessComponentFile.name}`
  const data = JSON.stringify(serverlessComponentFile)
  const serverlessAccessKey = process.env.SERVERLESS_ACCESS_KEY
  const headers = {
    Authorization: `Bearer ${serverlessAccessKey}`,
    'serverless-org-name': serverlessComponentFile.org,
    'content-type': 'application/json'
  }
  try {
    const res = await axios({
      method: 'put',
      url,
      data,
      headers
    })
    return res.data
  } catch (e) {
    if (e.response.status !== 200) {
      throw new Error(
        `${e.response.status} ${e.response.statusText || ''} ${e.response.data.message || ''}`
      )
    }
  }
}

const putComponentPackage = async (componentPackagePath, componentUploadUrl) => {
  // axios auto adds headers that causes signature mismatch
  // so we gotta hack it to remove that
  const instance = axios.create()
  instance.defaults.headers.common = {}
  instance.defaults.headers.put = {}
  const file = fs.readFileSync(componentPackagePath)

  try {
    await instance.put(componentUploadUrl.url, file)
  } catch (e) {
    throw e
  }
}

/**
 * Validate Component Definition
 */

const validateComponentDefinition = async (serverlessComponentFile) => {
  if (!serverlessComponentFile) {
    throw new Error('serverless.component.yml not found in the current working directory')
  }
  if (!serverlessComponentFile.name) {
    throw new Error('"name" is required in serverless.component.yml.')
  }
  if (!serverlessComponentFile.org) {
    throw new Error('"org" is required in serverless.component.yml.')
  }
  if (!serverlessComponentFile.author) {
    throw new Error('"author" is required in serverless.component.yml.')
  }
}

module.exports = async (cli) => {
  const serverlessComponentFile = getConfig('serverless.component')

  validateComponentDefinition(serverlessComponentFile)

  let cliEntity = serverlessComponentFile.name

  if (serverlessComponentFile.version) {
    cliEntity = `${serverlessComponentFile.name}@${serverlessComponentFile.version}`
  }
  if (!serverlessComponentFile.version || args.dev) {
    serverlessComponentFile.version = 'dev'
    cliEntity = `${serverlessComponentFile.name}@dev`
  }

  cli.status(`publishing`, cliEntity)

  cli.debug(`getting upload url`)

  const componentUploadUrl = await getComponentUploadUrl(serverlessComponentFile)

  const inputDirPath = process.cwd()
  const outputFilePath = path.join(
    tmpdir(),
    `${Math.random()
      .toString(36)
      .substring(6)}.zip`
  )

  cli.debug(`packaging component from ${inputDirPath}`)
  const componentPackagePath = await pack(inputDirPath, outputFilePath)
  cli.debug(`component packaged into ${outputFilePath}`)

  cli.debug(`uploading component package`)
  await putComponentPackage(componentPackagePath, componentUploadUrl)
  cli.debug(`component package uploaded`)

  cli.close('done', 'published')
}
