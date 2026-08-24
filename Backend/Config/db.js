const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('🔍 Checking Supabase credentials...');
console.log('  URL:', supabaseUrl);
console.log('  Service Key:', supabaseServiceKey ? '✅ Present (length: ' + supabaseServiceKey.length + ')' : '❌ Missing');

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing Supabase credentials. Check your .env file.');
    process.exit(1);
}

// Create Supabase client
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

// Test connection using the client
(async () => {
    try {
        console.log('🔍 Testing Supabase connection...');
        
        // Try to get a list of tables first
        const { data, error } = await supabase
            .from('students')
            .select('student_id, admission_number', { count: 'exact' })
            .limit(1);

        if (error) {
            console.error('❌ Supabase connection failed:', error.message);
            console.error('   Error details:', error);
            
            // Try alternative: check if the table exists
            try {
                const { data: tableCheck, error: tableError } = await supabase
                    .from('pg_tables')
                    .select('tablename')
                    .eq('schemaname', 'public')
                    .eq('tablename', 'students');
                
                if (tableError) {
                    console.error('   Table check failed:', tableError.message);
                } else if (tableCheck && tableCheck.length > 0) {
                    console.log('   ✅ students table exists');
                } else {
                    console.log('   ❌ students table does not exist in public schema');
                }
            } catch (checkErr) {
                console.error('   Table check error:', checkErr.message);
            }
        } else {
            console.log('✅ Connected to Supabase successfully!');
            console.log(`   Found student records in the database`);
        }
    } catch (err) {
        console.error('❌ Supabase connection error:', err.message);
        console.error('   Stack:', err.stack);
    }
})();

module.exports = supabase;