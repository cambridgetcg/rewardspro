console.log('=== CUSTOMER ID DETECTION TEST ===\n');

// Test 1: Check Liquid Detection
console.log('1. LIQUID DETECTION (Server-Side)');
const memberContent = document.querySelector('.rp-member');
const guestContent = document.querySelector('.rp-guest');

if (memberContent) {
  console.log('✅ SUCCESS: Liquid detected a logged-in customer');
  console.log('   - Showing member content');
} else if (guestContent) {
  console.log('❌ GUEST MODE: Liquid did NOT detect a customer');
  console.log('   - Showing guest content');
  console.log('   - Are you logged in?');
} else {
  console.log('❌ ERROR: No content found - widget might not be loaded');
}

// Test 2: Check JavaScript Data
console.log('\n2. JAVASCRIPT DATA (From Liquid)');
if (window.RewardsProData) {
  const widgetData = Object.values(window.RewardsProData)[0];
  console.log('✅ Customer data passed to JavaScript:');
  console.log('   - Customer ID:', widgetData.customerId);
  console.log('   - Email:', widgetData.customerEmail);
  console.log('   - Name:', widgetData.customerName);
  console.log('   - Shop:', widgetData.shopDomain);
  
  // Show the exact data structure
  console.log('\n3. RAW DATA STRUCTURE:');
  console.log(JSON.stringify(window.RewardsProData, null, 2));
  
} else {
  console.log('❌ No customer data in JavaScript');
  console.log('   - This means you are NOT logged in');
}

console.log('\n=== END TEST ===');