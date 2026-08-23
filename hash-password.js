const bcrypt = require('bcrypt');

const password = process.argv[2];

if (!password) {
    console.log('Usage: node hash-password.js YOUR_PASSWORD');
    process.exit(1);
}

bcrypt.hash(password, 12)
    .then(hash => {
        console.log(hash);
    })
    .catch(error => {
        console.error(error);
    });