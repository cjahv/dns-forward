#!/usr/bin/env node
const dgram = require('dgram');
const serverSocket = dgram.createSocket('udp4');
const {Resolver} = require('dns');
const resolver = new Resolver();

const debug = process.env.DEBUG;

const dns = process.argv[process.argv.indexOf('-d') + 1];
if (!dns || dns === process.argv[0]) {
    console.error('use -d set upstream dns');
    process.exit(2);
}
resolver.setServers([dns]);

const forward = process.argv[process.argv.indexOf('-f') + 1];

if (!forward || forward === process.argv[0]) {
    console.error('use -f set forward. eg: dns-forward -f 8.8.8.8:53');
    process.exit(1);
}

const [host, port] = forward.includes(':') ? forward.split(':').map((v, i) => i === 1 ? parseInt(v) : v) : [forward, 53];
const isDomain = !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
let cacheHost = null;

function log() {
    if (debug) {
        console.log.apply(console, arguments)
    }
}

function refreshCache(callback) {
    log('refresh host', host);
    resolver.resolve4(host, (err, addressList) => {
        if (err) return callback(false);
        if (addressList.length === 0) return callback(false);
        const address = addressList[0];
        if (address === cacheHost) return callback(false);
        cacheHost = address;
        log('new address is', address);
        callback(true);
    });
}

serverSocket.on('message', function (msg, rinfo) {
    const client = dgram.createSocket('udp4');
    let clientClosed = false;
    let clientTimer;
    client.on('error', (err) => {
        console.error('client error:\n', err.stack);
        cacheHost = null;
        client.close()
    });
    client.on('message', (fbMsg) => {
        log('on message', rinfo.address);
        serverSocket.send(fbMsg, rinfo.port, rinfo.address, (err) => {
            err && console.error(err)
        });
        client.close()
    });
    client.on('close', function () {
        clientClosed = true;
        if (clientTimer) clearTimeout(clientTimer);
    });
    client.on('listening', function () {
        clientTimer = setTimeout(function () {
            if (clientClosed === false) {
                cacheHost = null;
                client.close();
            }
        }, 3000)
    });
    if (isDomain) {
        if (!cacheHost) {
            refreshCache(res => {
                if (res) {
                    client.send(msg, port, cacheHost, (err) => {
                        if (err) {
                            console.error(err);
                            cacheHost = null;
                            client.close()
                        }
                    });
                } else {
                    log(`client error: analysis ${host} fail!`);
                    cacheHost = null;
                    client.close()
                }
            })
        } else {
            client.send(msg, port, cacheHost, (err) => {
                if (err) {
                    console.error(err);
                    cacheHost = null;
                    client.close()
                }
            });
        }
    } else {
        client.send(msg, port, host, (err) => {
            if (err) {
                console.error(err);
                client.close()
            }
        });
    }

});

serverSocket.on('error', function (err) {
    log('error, msg - %s, stack - %s\n', err.message, err.stack);
});

serverSocket.on('listening', function () {
    log(`server is listening on port ${serverSocket.address().port}.`);
    log(`forward to: ${host}:${port}${isDomain ? ' (domain)' : ''}`)
});

serverSocket.bind(parseInt(process.argv[process.argv.indexOf('-p') + 1]) || 5353);
