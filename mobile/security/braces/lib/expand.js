'use strict';

const fill = require('fill-range');
const stringify = require('./stringify');
const utils = require('./utils');

const append = (queue = '', stash = '', enclose = false) => {
  utils.validateArrays(queue, stash);
  const frame = (q = '', s = '') => ({ queue: [].concat(q), stash: [].concat(s),
    result: [], queueIndex: 0, valueIndex: 0, entered: false });
  const frames = [frame(queue, stash)];
  const finish = result => {
    frames.pop();
    if (frames.length) frames[frames.length - 1].result.push(result);
    return result;
  };
  while (frames.length) {
    const current = frames[frames.length - 1];
    if (!current.entered) {
      current.entered = true;
      if (!current.stash.length) {
        const result = finish(current.queue);
        if (!frames.length) return result;
        continue;
      }
      if (!current.queue.length) {
        const result = finish(enclose ? utils.flatten(current.stash).map(ele => `{${ele}}`) : current.stash);
        if (!frames.length) return result;
        continue;
      }
    }
    if (current.queueIndex === current.queue.length) {
      const result = finish(utils.flatten(current.result));
      if (!frames.length) return result;
      continue;
    }
    const item = current.queue[current.queueIndex];
    const values = Array.isArray(item) ? item : current.stash;
    if (current.valueIndex === values.length) {
      current.queueIndex++;
      current.valueIndex = 0;
      continue;
    }
    let value = values[current.valueIndex++];
    if (Array.isArray(item)) {
      frames.push(frame(value, current.stash));
    } else {
      if (enclose && typeof value === 'string') value = `{${value}}`;
      if (Array.isArray(value)) frames.push(frame(item, value));
      else current.result.push(item + value);
    }
  }
};

const expand = (ast, options = {}) => {
  utils.validateAst(ast, options);
  const rangeLimit = options.rangeLimit === undefined ? 1000 : options.rangeLimit;

  const walk = (node, parent = {}) => {
    node.queue = [];

    let p = parent;
    let q = parent.queue;

    while (p.type !== 'brace' && p.type !== 'root' && p.parent) {
      p = p.parent;
      q = p.queue;
    }

    if (node.invalid || node.dollar) {
      q.push(append(q.pop(), stringify(node, options)));
      return;
    }

    if (node.type === 'brace' && node.invalid !== true && node.nodes.length === 2) {
      q.push(append(q.pop(), ['{}']));
      return;
    }

    if (node.nodes && node.ranges > 0) {
      const args = utils.reduce(node.nodes);
      const limits = args.concat([options.step, rangeLimit]);

      if (utils.exceedsLimit(limits[0], limits[1], limits[2], limits[3])) {
        throw new RangeError('expanded array length exceeds range limit. Use options.rangeLimit to increase or disable the limit.');
      }

      const parameters = args.concat([options]);
      let range = fill(parameters[0], parameters[1], parameters[2], parameters[3]);
      if (range.length === 0) {
        range = stringify(node, options);
      }

      q.push(append(q.pop(), range));
      node.nodes = [];
      return;
    }

    const enclose = utils.encloseBrace(node);
    let queue = node.queue;
    let block = node;

    while (block.type !== 'brace' && block.type !== 'root' && block.parent) {
      block = block.parent;
      queue = block.queue;
    }

    for (let i = 0; i < node.nodes.length; i++) {
      const child = node.nodes[i];

      if (child.type === 'comma' && node.type === 'brace') {
        if (i === 1) queue.push('');
        queue.push('');
        continue;
      }

      if (child.type === 'close') {
        q.push(append(q.pop(), queue, enclose));
        continue;
      }

      if (child.value && child.type !== 'open') {
        queue.push(append(queue.pop(), child.value));
        continue;
      }

      if (child.nodes) {
        walk(child, node);
      }
    }

    return queue;
  };

  return utils.flatten(walk(ast));
};

module.exports = expand;
