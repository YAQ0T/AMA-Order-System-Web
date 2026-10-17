const { sendPushNotification } = require('./utils/push');

// Test push notification
// Replace USER_ID with the actual taker's user ID
const TEST_USER_ID = 1; // Change this to your taker's ID

const payload = {
    title: '🧪 Test Notification',
    body: 'This is a test push notification. If you see this, push notifications are working!',
    url: '/'
};

console.log(`Sending test push notification to user ${TEST_USER_ID}...`);

sendPushNotification(TEST_USER_ID, payload)
    .then(() => {
        console.log('✅ Push notification sent successfully!');
        console.log('Check your mobile device for the notification.');
        process.exit(0);
    })
    .catch(err => {
        console.error('❌ Failed to send push notification:', err);
        process.exit(1);
    });
