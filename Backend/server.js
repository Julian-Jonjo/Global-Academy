const express = require('express');
const cors = require('cors');
const path = require('path');

const pool = require('./config/db');

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

app.use(
    '/api/auth',
    authRoutes
);


app.use(
    '/api/students',
    studentRoutes
);


app.use(
    '/api/classes',
    classRoutes
);


app.use(
    '/api/guardians',
    guardianRoutes
);


app.use(
    '/api/approvals',
    approvalRoutes
);

app.use(
    '/api/payments',
    paymentRoutes
);

// ============================================================
// ROOT API
// ============================================================

app.get('/', (req, res) => {

    res.json({

        message:
            'Global Academy, Kono API is running'

    });

});


// ============================================================
// DATABASE TEST
// ============================================================

app.get(
    '/api/test-db',
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    'SELECT current_database(), current_user'
                );


            res.json({

                message:
                    'Database connection successful',

                database:
                    result.rows[0].current_database,

                user:
                    result.rows[0].current_user

            });

        } catch (error) {

            console.error(error);


            res.status(500).json({

                message:
                    'Database connection failed',

                error:
                    error.message

            });

        }

    }
);


// ============================================================
// PROTECTED TEST
// ============================================================

app.get(
    '/api/protected-test',

    authenticateToken,

    (req, res) => {

        res.json({

            message:
                'You are authenticated',

            user:
                req.user

        });

    }
);


// ============================================================
// SERVER
// ============================================================

const PORT = 5000;


app.listen(
    PORT,
    () => {

        console.log(
            `Global Academy server running on port ${PORT}`
        );

        console.log(
            `Frontend available at: http://localhost:${PORT}`
        );

        console.log(
            `Student registration: http://localhost:${PORT}/students-registration.html`
        );

    }
);