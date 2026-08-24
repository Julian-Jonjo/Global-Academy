const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
    try {
        // Test the students table directly
        const { data, error } = await supabase
            .from('students')
            .select('*', { count: 'exact', head: true });
        
        if (error) {
            console.error('❌ Students table error:', error.message);
        } else {
            console.log('✅ Students table exists!');
            console.log('   Count:', data);
        }

        // Test the student_fee_balances view
        const { data: balanceData, error: balanceError } = await supabase
            .from('student_fee_balances')
            .select('*', { count: 'exact', head: true });
        
        if (balanceError) {
            console.error('❌ student_fee_balances view error:', balanceError.message);
        } else {
            console.log('✅ student_fee_balances view exists!');
        }
    } catch (err) {
        console.error('❌ Exception:', err.message);
    }
}

test();