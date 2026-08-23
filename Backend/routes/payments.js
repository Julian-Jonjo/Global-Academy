const express = require('express');
const pool = require('../config/db');

const {
    authenticateToken,
    requireRoles
} = require('../middleware/authMiddleware');

const router = express.Router();


// ============================================================
// GET ALL FEE TYPES
// ============================================================

router.get(
    '/fee-types',
    authenticateToken,
    requireRoles(
        'Manager',
        'Administrator',
        'Proprietor'
    ),
    async (req, res) => {

        try {

            const result = await pool.query(`
                SELECT
                    fee_type_id,
                    fee_name,
                    description,
                    is_active,
                    created_at
                FROM fee_types
                WHERE is_active = TRUE
                ORDER BY fee_name
            `);

            res.json({
                success: true,
                feeTypes: result.rows
            });

        } catch (error) {

            console.error(
                'GET FEE TYPES ERROR:',
                error
            );

            res.status(500).json({
                success: false,
                message: 'Failed to load fee types.',
                error: error.message
            });

        }

    }
);


// ============================================================
// GET ALL ADMITTED / ACTIVE STUDENTS
//
// This is the main list for the new Finance Dashboard.
// ============================================================

router.get(
    '/students',
    authenticateToken,
    requireRoles(
        'Manager',
        'Administrator',
        'Proprietor'
    ),
    async (req, res) => {

        try {

            const result = await pool.query(`

                SELECT

                    s.student_id,

                    s.admission_number,

                    TRIM(
                        CONCAT_WS(
                            ' ',
                            s.first_name,
                            s.middle_name,
                            s.last_name
                        )
                    ) AS student_name,

                    c.class_name,

                    c.arm,

                    COALESCE(
                        finance.total_expected,
                        0
                    ) AS total_expected,

                    COALESCE(
                        finance.total_paid,
                        0
                    ) AS total_paid,

                    COALESCE(
                        finance.total_balance,
                        0
                    ) AS total_balance,

                    COALESCE(
                        finance.fee_count,
                        0
                    ) AS fee_count,

                    COALESCE(
                        finance.paid_fees,
                        0
                    ) AS paid_fees,

                    COALESCE(
                        finance.partially_paid_fees,
                        0
                    ) AS partially_paid_fees,

                    COALESCE(
                        finance.unpaid_fees,
                        0
                    ) AS unpaid_fees

                FROM students s

                LEFT JOIN classes c
                    ON s.class_id = c.class_id

                LEFT JOIN (

                    SELECT

                        student_id,

                        SUM(amount_due)
                            AS total_expected,

                        SUM(total_paid)
                            AS total_paid,

                        SUM(
                            CASE
                                WHEN balance > 0
                                THEN balance
                                ELSE 0
                            END
                        ) AS total_balance,

                        COUNT(*)
                            AS fee_count,

                        COUNT(
                            CASE
                                WHEN payment_status = 'Paid'
                                THEN 1
                            END
                        ) AS paid_fees,

                        COUNT(
                            CASE
                                WHEN payment_status = 'Partially Paid'
                                THEN 1
                            END
                        ) AS partially_paid_fees,

                        COUNT(
                            CASE
                                WHEN payment_status = 'Unpaid'
                                THEN 1
                            END
                        ) AS unpaid_fees

                    FROM student_fee_balances

                    GROUP BY student_id

                ) finance
                    ON finance.student_id = s.student_id

                WHERE
                    s.student_status = 'Active'

                ORDER BY
                    s.first_name,
                    s.last_name,
                    s.admission_number

            `);

            res.json({
                success: true,
                students: result.rows
            });

        } catch (error) {

            console.error(
                'GET FINANCE STUDENTS ERROR:',
                error
            );

            res.status(500).json({
                success: false,
                message: 'Failed to load admitted students.',
                error: error.message
            });

        }

    }
);


// ============================================================
// GET ONE STUDENT'S COMPLETE FINANCE RECORD
//
// Used when Finance clicks a student.
// ============================================================

router.get(
    '/student/:studentId',
    authenticateToken,
    requireRoles(
        'Manager',
        'Administrator',
        'Proprietor'
    ),
    async (req, res) => {

        try {

            const studentId =
                Number(req.params.studentId);


            if (
                !Number.isInteger(studentId) ||
                studentId <= 0
            ) {

                return res.status(400).json({
                    success: false,
                    message: 'Invalid student ID.'
                });

            }


            // ------------------------------------------------
            // STUDENT INFORMATION
            // ------------------------------------------------

            const studentResult =
                await pool.query(`

                    SELECT

                        s.student_id,

                        s.admission_number,

                        TRIM(
                            CONCAT_WS(
                                ' ',
                                s.first_name,
                                s.middle_name,
                                s.last_name
                            )
                        ) AS student_name,

                        c.class_name,

                        c.arm,

                        s.student_status

                    FROM students s

                    LEFT JOIN classes c
                        ON s.class_id = c.class_id

                    WHERE
                        s.student_id = $1
                        AND s.student_status = 'Active'

                `, [studentId]);


            if (!studentResult.rows.length) {

                return res.status(404).json({
                    success: false,
                    message: 'Active student not found.'
                });

            }


            const student =
                studentResult.rows[0];


            // ------------------------------------------------
            // STUDENT FEES
            // ------------------------------------------------

            const feesResult =
                await pool.query(`

                    SELECT

                        student_fee_id,

                        student_id,

                        admission_number,

                        student_name,

                        class_name,

                        arm,

                        fee_name,

                        academic_year,

                        term_name,

                        amount_due,

                        total_paid,

                        balance,

                        payment_status

                    FROM student_fee_balances

                    WHERE
                        student_id = $1

                    ORDER BY
                        fee_name,
                        academic_year,
                        term_name

                `, [studentId]);


            // ------------------------------------------------
            // PAYMENT HISTORY FOR THIS STUDENT
            // ------------------------------------------------

           const paymentsResult =
           await pool.query(`

           SELECT

            p.payment_id,

            p.payment_date,

            s.admission_number,

            TRIM(
                CONCAT_WS(
                    ' ',
                    s.first_name,
                    s.middle_name,
                    s.last_name
                )
            ) AS student_name,

            c.class_name,

            c.arm,

            ft.fee_name,

            p.amount_paid,

            p.payment_method,

            p.payment_slip_number,

            p.bank_reference,

            p.purpose,

            p.notes

        FROM payments p

        JOIN students s
            ON p.student_id = s.student_id

        LEFT JOIN classes c
            ON s.class_id = c.class_id

        JOIN student_fees sf
            ON p.student_fee_id = sf.student_fee_id

        JOIN fee_types ft
            ON sf.fee_type_id = ft.fee_type_id

        WHERE
            p.student_id = $1

        ORDER BY
            p.payment_date DESC,
            p.payment_id DESC

    `, [studentId]);


            // ------------------------------------------------
            // CALCULATE STUDENT TOTALS
            // ------------------------------------------------

            const totalsResult =
                await pool.query(`

                    SELECT

                        COALESCE(
                            SUM(amount_due),
                            0
                        ) AS total_expected,

                        COALESCE(
                            SUM(total_paid),
                            0
                        ) AS total_paid,

                        COALESCE(
                            SUM(
                                CASE
                                    WHEN balance > 0
                                    THEN balance
                                    ELSE 0
                                END
                            ),
                            0
                        ) AS total_balance

                    FROM student_fee_balances

                    WHERE
                        student_id = $1

                `, [studentId]);


            res.json({

                success: true,

                student,

                fees:
                    feesResult.rows,

                payments:
                    paymentsResult.rows,

                totals:
                    totalsResult.rows[0]

            });

        } catch (error) {

            console.error(
                'GET STUDENT FINANCE ERROR:',
                error
            );

            res.status(500).json({
                success: false,
                message: 'Failed to load student finance records.',
                error: error.message
            });

        }

    }
);


// ============================================================
// GET STUDENT FEE BALANCES
//
// Kept for compatibility with the existing dashboard.
// ============================================================

router.get(
    '/balances',
    authenticateToken,
    requireRoles(
        'Manager',
        'Administrator',
        'Proprietor'
    ),
    async (req, res) => {

        try {

            const result = await pool.query(`

                SELECT

                    student_fee_id,
                    student_id,
                    admission_number,
                    student_name,
                    class_name,
                    arm,
                    fee_name,
                    academic_year,
                    term_name,
                    amount_due,
                    total_paid,
                    balance,
                    payment_status

                FROM student_fee_balances

                ORDER BY
                    student_name,
                    fee_name

            `);

            res.json({
                success: true,
                balances: result.rows
            });

        } catch (error) {

            console.error(
                'GET FEE BALANCES ERROR:',
                error
            );

            res.status(500).json({
                success: false,
                message: 'Failed to load student fee balances.',
                error: error.message
            });

        }

    }
);


// ============================================================
// GET PAYMENT HISTORY
// ============================================================

router.get(
    '/history',
    authenticateToken,
    requireRoles(
        'Manager',
        'Administrator',
        'Proprietor'
    ),
    async (req, res) => {

        try {

            const result = await pool.query(`

                SELECT

                    payment_id,
                    payment_date,
                    admission_number,
                    student_name,
                    class_name,
                    arm,
                    fee_name,
                    amount_paid,
                    payment_method,
                    payment_slip_number,
                    bank_reference,
                    purpose,
                    notes

                FROM payment_history

                ORDER BY
                    payment_date DESC,
                    payment_id DESC

            `);

            res.json({
                success: true,
                payments: result.rows
            });

        } catch (error) {

            console.error(
                'GET PAYMENT HISTORY ERROR:',
                error
            );

            res.status(500).json({
                success: false,
                message: 'Failed to load payment history.',
                error: error.message
            });

        }

    }
);


// ============================================================
// GET OVERALL FINANCE SUMMARY
// ============================================================

router.get(
    '/summary',
    authenticateToken,
    requireRoles(
        'Manager',
        'Administrator',
        'Proprietor'
    ),
    async (req, res) => {

        try {

            const result =
                await pool.query(`

                    SELECT

                        COALESCE(
                            SUM(amount_due),
                            0
                        ) AS total_expected,

                        COALESCE(
                            SUM(total_paid),
                            0
                        ) AS total_collected,

                        COALESCE(
                            SUM(
                                CASE
                                    WHEN balance > 0
                                    THEN balance
                                    ELSE 0
                                END
                            ),
                            0
                        ) AS total_outstanding,

                        COUNT(*) AS total_fee_records,

                        COUNT(
                            CASE
                                WHEN payment_status = 'Paid'
                                THEN 1
                            END
                        ) AS paid_records,

                        COUNT(
                            CASE
                                WHEN payment_status = 'Partially Paid'
                                THEN 1
                            END
                        ) AS partially_paid_records,

                        COUNT(
                            CASE
                                WHEN payment_status = 'Unpaid'
                                THEN 1
                            END
                        ) AS unpaid_records

                    FROM student_fee_balances

                `);


            // ------------------------------------------------
            // TOTAL ACTIVE STUDENTS
            // ------------------------------------------------

            const studentsResult =
                await pool.query(`

                    SELECT COUNT(*) AS total_students

                    FROM students

                    WHERE
                        student_status = 'Active'

                `);


            res.json({

                success: true,

                summary: {

                    ...result.rows[0],

                    total_students:
                        studentsResult.rows[0].total_students

                }

            });

        } catch (error) {

            console.error(
                'FINANCE SUMMARY ERROR:',
                error
            );

            res.status(500).json({
                success: false,
                message: 'Failed to load finance summary.',
                error: error.message
            });

        }

    }
);


// ============================================================
// GET FINANCE SUMMARY BY FEE CATEGORY
//
// Example:
// Tuition
// Examination
// Development
// PTA
// Boarding
// etc.
// ============================================================

router.get(
    '/summary-by-fee',
    authenticateToken,
    requireRoles(
        'Manager',
        'Administrator',
        'Proprietor'
    ),
    async (req, res) => {

        try {

            const result =
                await pool.query(`

                    SELECT

                        fee_name,

                        COALESCE(
                            SUM(amount_due),
                            0
                        ) AS total_expected,

                        COALESCE(
                            SUM(total_paid),
                            0
                        ) AS total_collected,

                        COALESCE(
                            SUM(
                                CASE
                                    WHEN balance > 0
                                    THEN balance
                                    ELSE 0
                                END
                            ),
                            0
                        ) AS total_outstanding,

                        COUNT(*) AS total_records,

                        COUNT(
                            CASE
                                WHEN payment_status = 'Paid'
                                THEN 1
                            END
                        ) AS paid_records,

                        COUNT(
                            CASE
                                WHEN payment_status = 'Partially Paid'
                                THEN 1
                            END
                        ) AS partially_paid_records,

                        COUNT(
                            CASE
                                WHEN payment_status = 'Unpaid'
                                THEN 1
                            END
                        ) AS unpaid_records

                    FROM student_fee_balances

                    GROUP BY
                        fee_name

                    ORDER BY
                        fee_name

                `);


            res.json({

                success: true,

                categories:
                    result.rows

            });

        } catch (error) {

            console.error(
                'FEE CATEGORY SUMMARY ERROR:',
                error
            );

            res.status(500).json({

                success: false,

                message:
                    'Failed to load fee category summary.',

                error:
                    error.message

            });

        }

    }
);


// ============================================================
// RECORD PAYMENT
// ============================================================

router.post(
    '/',
    authenticateToken,
    requireRoles(
        'Manager',
        'Administrator'
    ),
    async (req, res) => {

        const client =
            await pool.connect();


        try {

            const {
                student_id,
                student_fee_id,
                amount_paid,
                payment_date,
                payment_method,
                payment_slip_number,
                bank_reference,
                purpose,
                notes
            } = req.body;


            const studentId =
                Number(student_id);

            const studentFeeId =
                Number(student_fee_id);

            const amount =
                Number(amount_paid);


            // ------------------------------------------------
            // VALIDATION
            // ------------------------------------------------

            if (
                !Number.isInteger(studentId) ||
                studentId <= 0
            ) {

                return res.status(400).json({
                    success: false,
                    message: 'A valid student is required.'
                });

            }


            if (
                !Number.isInteger(studentFeeId) ||
                studentFeeId <= 0
            ) {

                return res.status(400).json({
                    success: false,
                    message: 'A valid student fee is required.'
                });

            }


            if (
                !Number.isFinite(amount) ||
                amount <= 0
            ) {

                return res.status(400).json({
                    success: false,
                    message: 'Payment amount must be greater than zero.'
                });

            }


            await client.query('BEGIN');


            // ------------------------------------------------
            // VERIFY STUDENT
            // ------------------------------------------------

            const studentResult =
                await client.query(`

                    SELECT
                        student_id,
                        admission_number,
                        first_name,
                        middle_name,
                        last_name,
                        student_status

                    FROM students

                    WHERE
                        student_id = $1
                        AND student_status = 'Active'

                    FOR UPDATE

                `, [studentId]);


            if (!studentResult.rows.length) {

                await client.query('ROLLBACK');

                return res.status(404).json({
                    success: false,
                    message: 'Active student not found.'
                });

            }


            // ------------------------------------------------
            // VERIFY STUDENT FEE
            // ------------------------------------------------

            const feeResult =
                await client.query(`

                    SELECT

                        sf.student_fee_id,

                        sf.student_id,

                        sf.amount_due,

                        s.admission_number,

                        s.first_name,

                        s.middle_name,

                        s.last_name,

                        ft.fee_name

                    FROM student_fees sf

                    JOIN students s
                        ON sf.student_id = s.student_id

                    JOIN fee_types ft
                        ON sf.fee_type_id = ft.fee_type_id

                    WHERE

                        sf.student_fee_id = $1

                        AND sf.student_id = $2

                        AND s.student_status = 'Active'

                    FOR UPDATE

                `, [
                    studentFeeId,
                    studentId
                ]);


            if (!feeResult.rows.length) {

                await client.query('ROLLBACK');

                return res.status(404).json({
                    success: false,
                    message: 'Student fee record not found.'
                });

            }


            const fee =
                feeResult.rows[0];


            // ------------------------------------------------
            // CURRENT PAYMENTS
            // ------------------------------------------------

            const paidResult =
                await client.query(`

                    SELECT

                        COALESCE(
                            SUM(amount_paid),
                            0
                        ) AS total_paid

                    FROM payments

                    WHERE
                        student_fee_id = $1

                `, [studentFeeId]);


            const totalPaid =
                Number(
                    paidResult.rows[0].total_paid
                );


            const amountDue =
                Number(
                    fee.amount_due
                );


            const balance =
                amountDue - totalPaid;


            // ------------------------------------------------
            // PREVENT OVERPAYMENT
            // ------------------------------------------------

            if (amount > balance) {

                await client.query('ROLLBACK');

                return res.status(400).json({

                    success: false,

                    message:
                        `Payment exceeds the outstanding balance. ` +
                        `Outstanding balance is Le${balance.toFixed(2)}.`

                });

            }


            // ------------------------------------------------
            // INSERT PAYMENT
            // ------------------------------------------------

            const paymentResult =
                await client.query(`

                    INSERT INTO payments (

                        student_id,

                        student_fee_id,

                        amount_paid,

                        payment_date,

                        payment_method,

                        payment_slip_number,

                        bank_reference,

                        purpose,

                        notes,

                        recorded_by

                    )

                    VALUES (

                        $1,

                        $2,

                        $3,

                        COALESCE(
                            $4,
                            CURRENT_TIMESTAMP
                        ),

                        $5,

                        $6,

                        $7,

                        $8,

                        $9,

                        $10

                    )

                    RETURNING *

                `, [

                    studentId,

                    studentFeeId,

                    amount,

                    payment_date || null,

                    payment_method || null,

                    payment_slip_number || null,

                    bank_reference || null,

                    purpose || fee.fee_name,

                    notes || null,

                    req.user.user_id

                ]);


            await client.query('COMMIT');


            // ------------------------------------------------
            // NEW BALANCE
            // ------------------------------------------------

            const newTotalPaid =
                totalPaid + amount;


            const newBalance =
                amountDue - newTotalPaid;


            let paymentStatus =
                'Unpaid';


            if (newTotalPaid >= amountDue) {

                paymentStatus =
                    'Paid';

            } else if (newTotalPaid > 0) {

                paymentStatus =
                    'Partially Paid';

            }


            res.status(201).json({

                success: true,

                message:
                    'Payment recorded successfully.',

                payment:
                    paymentResult.rows[0],

                balance: {

                    amount_due:
                        amountDue,

                    total_paid:
                        newTotalPaid,

                    balance:
                        newBalance,

                    payment_status:
                        paymentStatus

                }

            });


        } catch (error) {

            try {

                await client.query(
                    'ROLLBACK'
                );

            } catch (rollbackError) {

                console.error(
                    'ROLLBACK ERROR:',
                    rollbackError
                );

            }


            console.error(
                'RECORD PAYMENT ERROR:',
                error
            );


            res.status(500).json({

                success: false,

                message:
                    'Failed to record payment.',

                error:
                    error.message

            });

        } finally {

            client.release();

        }

    }
);


module.exports = router;