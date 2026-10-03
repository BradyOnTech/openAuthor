'use strict';

// Local maintained bound: parser containers and externally supplied ASTs share
// the same option contract. Every child edge also has a fixed recursion bound.
const MAX_DEPTH = 100;
const MAX_AST_EDGES = MAX_DEPTH + 1;

exports.normalizeDepth = (options = {}) => {
  const depth = options && options.maxDepth;
  if (depth === undefined) return MAX_DEPTH;
  if (!Number.isSafeInteger(depth) || depth < 0) {
    throw new TypeError('Braces maxDepth must be a nonnegative safe integer');
  }
  return Math.min(depth, MAX_DEPTH);
};

const scalar = value => value === undefined || value === null ||
  typeof value === 'string' || typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value));

// Queue/flatten arrays may share subarrays, but cannot contain cycles. Inspect
// them iteratively before expansion can mutate an externally supplied AST.
const arrayFrames = (values, visit) => {
  const active = new Set();
  const frames = [{ array: values, index: 0 }];
  active.add(values);
  while (frames.length) {
    const frame = frames[frames.length - 1];
    if (frame.index === frame.array.length) {
      active.delete(frame.array);
      frames.pop();
      continue;
    }
    const value = frame.array[frame.index++];
    if (Array.isArray(value)) {
      if (active.has(value)) throw new TypeError('Braces array contains a cycle');
      active.add(value);
      frames.push({ array: value, index: 0 });
    } else {
      visit(value);
    }
  }
};

exports.validateArrays = (...values) => arrayFrames(values, value => {
  if (!scalar(value)) throw new TypeError('Braces queue values must be scalars');
});

exports.validateAst = (ast, options = {}) => {
  const maxDepth = exports.normalizeDepth(options);
  const active = new Set();
  const parentLengths = new Map();
  const validateNode = node => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      throw new TypeError('Braces AST nodes must be objects');
    }
    if (!scalar(node.value)) throw new TypeError('Braces AST values must be scalars');
    for (const field of ['commas', 'ranges']) {
      if (node[field] !== undefined && (typeof node[field] !== 'number' ||
        (node.type === 'brace' && (!Number.isSafeInteger(node[field]) || node[field] < 0)))) {
        throw new TypeError('Braces AST counts must be numeric primitives');
      }
    }
    if (node.nodes !== undefined && !Array.isArray(node.nodes)) {
      throw new TypeError('Braces AST children must be an array');
    }
    if (node.queue !== undefined) {
      if (!Array.isArray(node.queue)) throw new TypeError('Braces AST queue must be an array');
      exports.validateArrays(node.queue);
    }
  };
  const validateParents = node => {
    const chain = [];
    const seen = new Set();
    let parent = node;
    while (parent && !parentLengths.has(parent)) {
      if (seen.has(parent)) throw new TypeError('Braces AST parent contains a cycle');
      validateNode(parent);
      seen.add(parent);
      chain.push(parent);
      if (chain.length > MAX_AST_EDGES + 1) {
        throw new RangeError('Braces AST parent depth exceeds local limit');
      }
      parent = parent.parent;
    }
    let length = parent ? parentLengths.get(parent) : 0;
    while (chain.length) {
      length++;
      if (length > MAX_AST_EDGES + 1) {
        throw new RangeError('Braces AST parent depth exceeds local limit');
      }
      parentLengths.set(chain.pop(), length);
    }
  };
  const frames = [{ node: ast, edgeDepth: 0, containerDepth: 0, entered: false, index: 0 }];
  while (frames.length) {
    const frame = frames[frames.length - 1];
    if (!frame.entered) {
      validateNode(frame.node);
      validateParents(frame.node);
      if (active.has(frame.node)) throw new TypeError('Braces AST children contain a cycle');
      if (frame.node.type === 'brace' || frame.node.type === 'paren') frame.containerDepth++;
      if (frame.containerDepth > maxDepth) throw new RangeError('Braces nesting exceeds maxDepth');
      if (frame.edgeDepth > maxDepth + 1) throw new RangeError('Braces AST child depth exceeds local limit');
      active.add(frame.node);
      frame.entered = true;
    }
    const children = frame.node.nodes || [];
    if (frame.index === children.length) {
      active.delete(frame.node);
      frames.pop();
      continue;
    }
    frames.push({ node: children[frame.index++], edgeDepth: frame.edgeDepth + 1,
      containerDepth: frame.containerDepth, entered: false, index: 0 });
  }
};

exports.isInteger = num => {
  if (typeof num === 'number') {
    return Number.isInteger(num);
  }
  if (typeof num === 'string' && num.trim() !== '') {
    return Number.isInteger(Number(num));
  }
  return false;
};

/**
 * Find a node of the given type
 */

exports.find = (node, type) => node.nodes.find(node => node.type === type);

/**
 * Find a node of the given type
 */

exports.exceedsLimit = (min, max, step = 1, limit) => {
  if (limit === false) return false;
  if (!exports.isInteger(min) || !exports.isInteger(max)) return false;
  return ((Number(max) - Number(min)) / Number(step)) >= limit;
};

/**
 * Escape the given node with '\\' before node.value
 */

exports.escapeNode = (block, n = 0, type) => {
  const node = block.nodes[n];
  if (!node) return;

  if ((type && node.type === type) || node.type === 'open' || node.type === 'close') {
    if (node.escaped !== true) {
      node.value = '\\' + node.value;
      node.escaped = true;
    }
  }
};

/**
 * Returns true if the given brace node should be enclosed in literal braces
 */

exports.encloseBrace = node => {
  if (node.type !== 'brace') return false;
  if ((node.commas >> 0 + node.ranges >> 0) === 0) {
    node.invalid = true;
    return true;
  }
  return false;
};

/**
 * Returns true if a brace node is invalid.
 */

exports.isInvalidBrace = block => {
  if (block.type !== 'brace') return false;
  if (block.invalid === true || block.dollar) return true;
  if ((block.commas >> 0 + block.ranges >> 0) === 0) {
    block.invalid = true;
    return true;
  }
  if (block.open !== true || block.close !== true) {
    block.invalid = true;
    return true;
  }
  return false;
};

/**
 * Returns true if a node is an open or close node
 */

exports.isOpenOrClose = node => {
  if (node.type === 'open' || node.type === 'close') {
    return true;
  }
  return node.open === true || node.close === true;
};

/**
 * Reduce an array of text nodes.
 */

exports.reduce = nodes => nodes.reduce((acc, node) => {
  if (node.type === 'text') acc.push(node.value);
  if (node.type === 'range') node.type = 'text';
  return acc;
}, []);

/**
 * Flatten an array
 */

exports.flatten = (...args) => {
  const result = [];
  arrayFrames(args, value => {
    if (value !== undefined) result.push(value);
  });
  return result;
};
