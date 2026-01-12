/**
 * Index store interface (documentation only).
 *
 * @typedef {Object} IndexStore
 * @property {Function} load - () => Array
 * @property {Function} clear - () => void
 * @property {Function} upsertChunks - (chunks) => Array
 * @property {Function} search - (query, topK) => Array
 */

const INDEX_STORE_INTERFACE = {
  load: undefined,
  clear: undefined,
  upsertChunks: undefined,
  search: undefined
};

module.exports = {
  INDEX_STORE_INTERFACE
};
