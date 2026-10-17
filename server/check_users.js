const { sequelize, User } = require('./db');

async function checkUsers() {
    try {
        const takers = await User.findAll({ where: { role: 'taker' } });
        const makers = await User.findAll({ where: { role: 'maker' } });

        console.log('--- Users Check ---');
        console.log(`Makers: ${makers.length}`);
        makers.forEach(u => console.log(` - ${u.username} (ID: ${u.id})`));

        console.log(`Takers: ${takers.length}`);
        takers.forEach(u => console.log(` - ${u.username} (ID: ${u.id})`));
        console.log('-------------------');
    } catch (error) {
        console.error('Error checking users:', error);
    } finally {
        await sequelize.close();
    }
}

checkUsers();
