const { User } = require('../db');
const bcrypt = require('bcryptjs');

async function seedAdmin() {
    try {
        // Check if admin already exists
        const existingAdmin = await User.findOne({ where: { role: 'admin' } });

        if (existingAdmin) {
            console.log('✓ Admin user already exists');
            return;
        }

        // Create default admin account
        const admin = await User.create({
            username: 'admin',
            password: 'admin123', // Will be hashed by beforeCreate hook
            role: 'admin',
            isApproved: true
        });

        console.log('✓ Default admin account created');
        console.log('  Username: admin');
        console.log('  Password: admin123');
        console.log('  ⚠️  PLEASE CHANGE THE PASSWORD AFTER FIRST LOGIN!');
    } catch (error) {
        console.error('Failed to seed admin:', error);
    }
}

module.exports = { seedAdmin };
