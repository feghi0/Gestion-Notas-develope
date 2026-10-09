const { randomBytes } = require("node:crypto");
module.exports = () => randomBytes(12).toString("base64url");
