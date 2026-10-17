const { sequelize, User, Order } = require('./db');

async function debug() {
    try {
        const users = await User.findAll();
        console.log('Users:', JSON.stringify(users, null, 2));

        const orders = await Order.findAll({
            include: [
                { model: User, as: 'AssignedTakers' }
            ]
        });
        console.log('Orders with Takers:', JSON.stringify(orders, null, 2));

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await sequelize.close();
    }
}

debug();
