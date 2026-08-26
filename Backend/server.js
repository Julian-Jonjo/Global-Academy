const express = require('express');
const cors = require('cors');
const path = require('path');

// Import Supabase instead of pool
const supabase = require('./Config/db');

const authRoutes = require('./routes/auth');

const {
    authenticateToken,
    requireRoles
} = require('./middleware/authMiddleware');

const studentRoutes = require('./routes/students');
const classRoutes = require('./routes/classes');
const guardianRoutes = require('./routes/guardians');
const approvalRoutes = require('./routes/approvals');
const paymentRoutes = require('./routes/payments');
const teacherRoutes = require('./routes/teachers');
const teacherPortalRoutes = require('./routes/teacherPortal');
const academicYearRoutes = require('./routes/academic-years');

const app = express();


// ============================================================
// MIDDLEWARE
// ============================================================

app.use(cors());
app.use(express.json());


// ============================================================
// SERVE FRONTEND FROM ROOT /public FOLDER
// ============================================================

app.use(
    express.static(
        path.join(__dirname, '../public')
    )
);


// ============================================================
// API ROUTES
// ============================================================

app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/guardians', guardianRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/teachers', teacherRoutes);
app.use('/api/teacher', teacherPortalRoutes);
app.use('/api/academic-years', academicYearRoutes);


// ============================================================
// ROOT API
// ============================================================

app.get('/', (req, res) => {
    res.json({
        message: 'Global Academy, Kono API is running'
    });
});


// ============================================================
// DATABASE TEST (Updated for Supabase)
// ============================================================

app.get('/api/test-db', async (req, res) => {
    try {
        // Test Supabase connection by counting students
        const { data, error, count } = await supabase
            .from('students')
            .select('*', { count: 'exact', head: true });

        if (error) {
            throw new Error(error.message);
        }

        // Get database info from Supabase
        const { data: dbInfo, error: dbError } = await supabase
            .from('students')
            .select('*', { count: 'exact', head: true });

        res.json({
            message: 'Database connection successful',
            platform: 'Supabase',
            student_count: count || 0,
            status: 'connected'
        });

    } catch (error) {
        console.error('DATABASE TEST ERROR:', error);
        res.status(500).json({
            message: 'Database connection failed',
            error: error.message
        });
    }
});


// ============================================================
// PROTECTED TEST
// ============================================================

app.get(
    '/api/protected-test',
    authenticateToken,
    (req, res) => {
        res.json({
            message: 'You are authenticated',
            user: req.user
        });
    }
);


// ============================================================
// SERVER
// ============================================================

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Global Academy server running on port ${PORT}`);
    console.log(`Frontend available at: http://localhost:${PORT}`);
    console.log(`Student registration: http://localhost:${PORT}/students-registration.html`);
});