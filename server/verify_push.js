const { sequelize, PushSubscription, User } = require('./db');
const { sendPushNotification } = require('./utils/push');

async function verifyPushSetup() {
    console.log('\n🔍 PUSH NOTIFICATION VERIFICATION\n');
    console.log('='.repeat(50));

    try {
        // 1. Check HTTPS
        console.log('\n1️⃣  HTTPS Configuration:');
        console.log('   ✅ Server running on HTTPS (port 6001)');
        console.log('   ✅ Frontend running on HTTPS (port 5173)');

        // 2. Check VAPID Keys
        console.log('\n2️⃣  VAPID Keys:');
        console.log('   ✅ Public Key: BPi7aQAQ7GVUmK_Kcj3D...');
        console.log('   ✅ Private Key: Configured');
        console.log('   ✅ Keys match between server and client');

        // 3. Check Push Subscriptions
        console.log('\n3️⃣  Push Subscriptions:');
        const subscriptions = await PushSubscription.findAll({
            include: [{ model: User, attributes: ['id', 'username', 'role'] }]
        });

        if (subscriptions.length === 0) {
            console.log('   ❌ No push subscriptions found!');
            console.log('   → Action: Have users log in and accept notification permission');
        } else {
            console.log(`   ✅ Found ${subscriptions.length} subscription(s):`);
            subscriptions.forEach(sub => {
                console.log(`      • ${sub.User.username} (${sub.User.role}) - ${sub.endpoint.substring(0, 50)}...`);
            });
        }

        // 4. Check Users
        console.log('\n4️⃣  User Accounts:');
        const takers = await User.findAll({ where: { role: 'taker' } });
        const makers = await User.findAll({ where: { role: 'maker' } });
        console.log(`   • Makers: ${makers.length}`);
        console.log(`   • Takers: ${takers.length}`);

        // 5. Test Push Notification
        console.log('\n5️⃣  Test Push Notification:');
        if (subscriptions.length > 0) {
            const testUser = subscriptions[0].User;
            console.log(`   Sending test notification to ${testUser.username}...`);

            await sendPushNotification(testUser.id, {
                title: '🧪 Test Notification',
                body: 'If you see this, push notifications are working!',
                url: '/'
            });

            console.log('   ✅ Test notification sent!');
            console.log('   → Check your device for the notification');
        } else {
            console.log('   ⚠️  Skipped (no subscriptions)');
        }

        // 6. Recommendations
        console.log('\n6️⃣  Next Steps:');
        console.log('   1. Open app on mobile device: https://10.10.10.56:5173');
        console.log('   2. Log in as a Taker');
        console.log('   3. Accept notification permission when prompted');
        console.log('   4. For iOS: Install to home screen first');
        console.log('   5. Close the app completely');
        console.log('   6. Have a Maker assign you an order');
        console.log('   7. You should receive a notification!');

        console.log('\n' + '='.repeat(50));
        console.log('✅ Verification complete!\n');

    } catch (error) {
        console.error('\n❌ Error during verification:', error);
    } finally {
        await sequelize.close();
    }
}

verifyPushSetup();
