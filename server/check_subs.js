const { sequelize, PushSubscription, User } = require('./db');

async function checkSubscriptions() {
    try {
        const subs = await PushSubscription.findAll({
            include: [{ model: User, attributes: ['username'] }]
        });

        console.log('--- Active Push Subscriptions ---');
        if (subs.length === 0) {
            console.log('No subscriptions found.');
        } else {
            subs.forEach(sub => {
                console.log(`User: ${sub.User ? sub.User.username : 'Unknown'} | Endpoint: ${sub.endpoint.substring(0, 50)}...`);
            });
        }
        console.log('---------------------------------');
    } catch (error) {
        console.error('Error checking subscriptions:', error);
    } finally {
        await sequelize.close();
    }
}

checkSubscriptions();
