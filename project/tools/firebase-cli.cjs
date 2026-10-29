// Preserve normal ADC authentication and API checks while respecting the existing proxy.
const api = require('firebase-tools/lib/apiv2');
const {HttpsProxyAgent} = require('https-proxy-agent');
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
if (proxy) api.noKeepAliveAgent = () => new HttpsProxyAgent(proxy);
require('firebase-tools/lib/bin/firebase');
