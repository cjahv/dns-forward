const dgram = require('dgram');
const serverSocket = dgram.createSocket('udp4');
const {Resolver} = require('dns');
const resolver = new Resolver();

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

function refreshCache(callback) {
    resolver.resolve4(host, (err, addressList) => {
        if (err) return callback(false);
        if (addressList.length === 0) return callback(false);
        const address = addressList[0];
        if (address === cacheHost) return callback(false);
        cacheHost = address;
        callback(true);
    });
}

serverSocket.on('message', function (msg, rinfo) {
    const client = dgram.createSocket('udp4');
    client.on('error', (err) => {
        console.log(`client error:\n${err.stack}`);
        client.close()
    });
    client.on('message', (fbMsg) => {
        serverSocket.send(fbMsg, rinfo.port, rinfo.address, (err) => {
            err && console.log(err)
        });
        client.close()
    });
    if (isDomain) {
        if (!cacheHost) {
            refreshCache(res => {
                if (res) {
                    client.send(msg, port, cacheHost, (err) => {
                        if (err) {
                            console.log(err);
                            client.close()
                        }
                    });
                } else {
                    console.log(`client error: analysis ${host} fail!`);
                    client.close()
                }
            })
        } else {
            client.send(msg, port, cacheHost, (err) => {
                if (err) {
                    console.log(err);
                    client.close()
                }
            });
        }
    } else {
        client.send(msg, port, host, (err) => {
            if (err) {
                console.log(err);
                client.close()
            }
        });
    }
});

serverSocket.on('error', function (err) {
    console.log('error, msg - %s, stack - %s\n', err.message, err.stack);
});

serverSocket.on('listening', function () {
    console.log(`server is listening on port ${serverSocket.address().port}.`);
    console.log(`forward to: ${host}:${port}${isDomain ? ' (domain)' : ''}`)
});

serverSocket.bind(parseInt(process.argv[process.argv.indexOf('-p') + 1]) || 5353);
