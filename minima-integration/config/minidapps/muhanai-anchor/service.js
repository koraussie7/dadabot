/**
 * MuhanAI Anchor Minidapp Service
 * 
 * Anchors content hashes (SHA-256) to Minima chain via MDS.
 * Based on agent-memory/service.js pattern.
 * 
 * MDS.registerOnChain pattern:
 * MDS.create({
 *   script: "RETURN SIGNEDBY(@INPUT 0)",
 *   amount: 0.001,
 *   state: [address, cid, namespace, timestamp, size, path]
 * })
 */

const MDS = require("mds");
const crypto = require("crypto");

class AnchorService {
  constructor(mds, config) {
    this.mds = mds;
    this.config = config;
    this.namespace = config.mds?.namespace || "anchor";
    this.pathPrefix = config.mds?.pathPrefix || "anchor/";
    this.maxContentSize = config.mds?.maxContentSize || 1048576;
    this.defaultAmount = config.mds?.defaultAmount || "0.001";
  }

  /**
   * Compute SHA-256 hash of content
   */
  hashContent(content) {
    const data = typeof content === "string" 
      ? Buffer.from(content, "utf8") 
      : content;
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  /**
   * Anchor content to Minima chain via MDS
   * 
   * @param {Object} options
   * @param {string|Buffer} options.content - Content to anchor
   * @param {string} options.namespace - Namespace (default: "anchor")
   * @param {string} options.path - Path within namespace
   * @param {string} options.address - Address to sign with
   * @param {Object} options.metadata - Additional metadata
   * @returns {Promise<Object>} { txid, hash, blockHeight, timestamp }
   */
  async anchor(options) {
    const { content, namespace, path, address, metadata } = options;
    const ns = namespace || this.namespace;
    const cid = this.hashContent(content);
    const size = Buffer.isBuffer(content) ? content.length : Buffer.byteLength(content, "utf8");
    const timestamp = Date.now();
    const path = options.path || `${this.pathPrefix}${cid.slice(0, 16)}`;
    const address = options.address || this.getDefaultAddress();

    if (content.length > this.maxContentSize) {
      throw new Error(`Content exceeds max size of ${this.maxContentSize} bytes`);
    }

    // MDS.create pattern from agent-memory/service.js
    const state = [
      address,
      cid,
      namespace,
      timestamp.toString(),
      size.toString(),
      path
    ];

    const params = {
      script: "RETURN SIGNEDBY(@INPUT 0)",
      amount: this.defaultAmount,
      state: state
    };

    try {
      const result = await this.mds.create(params);
      
      return {
        txid: result.txid,
        hash: cid,
        blockHeight: result.blockHeight,
        timestamp: timestamp,
        cid: cid,
        size: size,
        namespace: namespace,
        path: path,
        metadata: options.metadata
      };
    } catch (error) {
      throw new Error(`Anchor failed: ${error.message}`);
    }
  }

  /**
   * Anchor string content
   */
  async anchorString(text, namespace, path) {
    return this.anchor({ content: text, namespace, path });
  }

  /**
   * Anchor binary data
   */
  async anchorBytes(bytes, namespace, path) {
    return this.anchor({ content: bytes, namespace, path });
  }

  /**
   * Retrieve anchored content by CID
   */
  async retrieve(cid, namespace) {
    const ns = namespace || this.namespace;
    return this.mds.retrieve({ cid, namespace: ns });
  }

  /**
   * List anchored items in namespace
   */
  async list(namespace, limit = 50, offset = 0) {
    const ns = namespace || this.namespace;
    return this.mds.list({ namespace: ns, limit, offset });
  }

  getDefaultAddress() {
    // In production, get from MDS config or environment
    return process.env.MINIMA_ADDRESS || "unknown";
  }
}

module.exports = { AnchorService };