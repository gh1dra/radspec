/**
 * @typedef {Object} Binding
 * @property {string} type The type of the binding (a valid Radspec type)
 * @property {*} value The value of the binding
 */
/**
 * @typedef {Object.<string, Binding>} Bindings
 */

/**
 * @module radspec
 */
const ABI = require('web3-eth-abi')
const MetadataDAO = require('metadata-dao')

const scanner = require('./scanner')
const parser = require('./parser')
const evaluator = require('./evaluator')

/**
 * Evaluate a radspec expression with manual bindings.
 *
 * @example
 * const radspec = require('radspec')
 *
 * radspec.evaluateRaw('a is `a`', {
 *   a: { type: 'int256', value: 10 }
 * }).then(console.log)
 * @param  {string} source The radspec expression
 * @param  {Bindings} bindings An object of bindings and their values
 * @param {?Object} evaluatorOptions An options object for the evaluator
 * @return {Promise<string>} The result of the evaluation
 */
function evaluateRaw (source, bindings, evaluatorOptions) {
  return scanner.scan(source)
    .then(parser.parse)
    .then((ast) => evaluator.evaluate(ast, bindings, evaluatorOptions))
}

/**
 * Evaluate a radspec expression (`source`) for a transaction (`call`)
 *
 * @example
 * const radspec = require('radspec')
 *
 * const expression = 'Will multiply `a` by 7 and return `a * 7`.'
 * const call = {
 *   abi: [{
 *     name: 'multiply',
 *     constant: false,
 *     type: 'function',
 *     inputs: [{
 *       name: 'a',
 *       type: 'uint256'
 *     }],
 *     outputs: [{
 *       name: 'd',
 *       type: 'uint256'
 *     }]
 *   }],
 *   transaction: {
 *     to: '0x8521742d3f456bd237e312d6e30724960f72517a',
 *     data: '0xc6888fa1000000000000000000000000000000000000000000000000000000000000007a'
 *   }
 * }
 *
 * radspec.evaluate(expression, call)
 *   .then(console.log) // => "Will multiply 122 by 7 and return 854."
 * @param {string} source The radspec expression
 * @param {Object} call The call that determines the bindings for this evaluation
 * @param {Array} call.abi The ABI used to decode the transaction data
 * @param {Object} call.transaction The transaction to decode for this evaluation
 * @param {string} call.transaction.to The destination address for this transaction
 * @param {string} call.transaction.data The transaction data
 * @param {?Object} options An options object
 * @param {?string} options.ethNode The URL to an Ethereum node
 * @return {Promise<string>} The result of the evaluation
 */
function evaluate (source, call, options = {}) {
  // Get method ID
  const methodId = call.transaction.data.substr(0, 10)

  // Find method ABI
  const method = call.abi.find((abi) =>
    abi.type === 'function' &&
    methodId === ABI.encodeFunctionSignature(abi))

  // Decode parameters
  const parameterValues = ABI.decodeParameters(
    method.inputs,
    '0x' + call.transaction.data.substr(10)
  )
  const parameters = method.inputs.reduce((parameters, input) =>
    Object.assign(
      parameters, {
        [input.name]: {
          type: input.type,
          value: parameterValues[input.name]
        }
      }
    ), {})

  // Evaluate expression with bindings from
  // the transaction data
  return evaluateRaw(source, parameters, { ...options, to: call.transaction.to })
}

async function metadataDAOEvaluate (call, options = {}) {
  const metadataDAO = new MetadataDAO()

  // Get method ID
  const { to, data } = call.transaction
  const methodId = data.substr(0, 10)

  const fn = await metadataDAO.query('radspec', 'sig', methodId)

  if (!fn) {
    return null
  }

  // If the function was found in local radspec registry. Decode and evaluate.
  const { notice: source, signature: sig } = fn

  // get the array of input types from the function signature
  const inputString = sig.replace(')', '').split('(')[1]

  let parameters = []

  // If the function has parameters
  if (inputString !== '') {
    const inputs = inputString.split(',')

    // Decode parameters
    const parameterValues = ABI.decodeParameters(inputs, '0x' + data.substr(10))
    parameters = inputs.reduce((acc, input, i) => (
      {
        [`$${i + 1}`]: {
          type: input,
          value: parameterValues[i]
        },
        ...acc
      }), {})
  }

  return await evaluateRaw(source, parameters, { ...options, to })
}

module.exports = {
  scan: scanner.scan,
  parse: parser.parse,

  evaluateRaw,
  evaluate,
  metadataDAOEvaluate
}
