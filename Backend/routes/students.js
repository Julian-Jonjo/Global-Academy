const express = require('express');
const pool = require('../config/db');

const {
    authenticateToken,
    requireRoles
} = require('../middleware/authMiddleware');

const router = express.Router();


// ============================================================
// GET ALL STUDENTS
// ============================================================

router.get(
    '/',
    authenticateToken,
    requireRoles(
        'Manager',
        'Administrator',
        'Proprietor'
    ),
    async (req, res) => {

        try {

            const {
                search,
                class_id,
                status
            } = req.query;

            let query = `
                SELECT

                    s.student_id,
                    s.admission_number,
                    s.first_name,
                    s.middle_name,
                    s.last_name,
                    s.gender,
                    s.date_of_birth,
                    s.phone,
                    s.address,
                    s.class_id,
                    s.guardian_id,
                    s.admission_date,
                    s.student_status,
                    s.photo_url,
                    s.created_at,
                    s.nationality,
                    s.previous_school,
                    s.emergency_contact_name,
                    s.emergency_contact_phone,
                    s.emergency_contact_relationship,
                    s.registration_date,

                    c.class_name,
                    c.arm,

                    g.full_name AS guardian_name,
                    g.relationship AS guardian_relationship,
                    g.phone AS guardian_phone,
                    g.email AS guardian_email,
                    g.address AS guardian_address

                FROM students s

                LEFT JOIN classes c
                    ON s.class_id = c.class_id

                LEFT JOIN guardians g
                    ON s.guardian_id = g.guardian_id

                WHERE 1 = 1
            `;

            const values = [];

            let parameterIndex = 1;


            // Search by admission number
            // or student name

            if (search) {

                query += `
                    AND (
                        LOWER(s.admission_number)
                            LIKE LOWER($${parameterIndex})

                        OR LOWER(s.first_name)
                            LIKE LOWER($${parameterIndex})

                        OR LOWER(s.middle_name)
                            LIKE LOWER($${parameterIndex})

                        OR LOWER(s.last_name)
                            LIKE LOWER($${parameterIndex})
                    )
                `;

                values.push(`%${search}%`);

                parameterIndex++;

            }


            // Filter by class

            if (class_id) {

                query += `
                    AND s.class_id =
                        $${parameterIndex}
                `;

                values.push(class_id);

                parameterIndex++;

            }


            // Filter by student status

            if (status) {

                query += `
                    AND s.student_status =
                        $${parameterIndex}
                `;

                values.push(status);

                parameterIndex++;

            }


            query += `
                ORDER BY
                s.admission_number ASC
            `;


            const result =
                await pool.query(
                    query,
                    values
                );


            res.json(result.rows);


        } catch (error) {

            console.error(
                'Error loading students:',
                error
            );


            res.status(500).json({

                message:
                    'Failed to load students'

            });

        }

    }
);


// ============================================================
// CREATE NEW STUDENT REGISTRATION
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

                admission_number,
                first_name,
                middle_name,
                last_name,
                gender,
                date_of_birth,
                phone,
                address,
                class_id,
                guardian_id,
                admission_date,
                student_status,
                nationality,
                previous_school,
                emergency_contact_name,
                emergency_contact_phone,
                emergency_contact_relationship,
                registration_date

            } = req.body;


            // Required fields

            if (
                !admission_number ||
                !first_name ||
                !last_name
            ) {

                return res.status(400).json({

                    message:
                        'Admission number, first name and last name are required'

                });

            }


            await client.query(
                'BEGIN'
            );


            // Check duplicate admission number

            const existingStudent =
                await client.query(
                    `
                    SELECT student_id
                    FROM students
                    WHERE admission_number = $1
                    `,
                    [
                        admission_number
                    ]
                );


            if (
                existingStudent.rows.length > 0
            ) {

                await client.query(
                    'ROLLBACK'
                );


                return res.status(409).json({

                    message:
                        'A student with this admission number already exists'

                });

            }


            // Create student

            const studentResult =
                await client.query(
                    `
                    INSERT INTO students (

                        admission_number,
                        first_name,
                        middle_name,
                        last_name,
                        gender,
                        date_of_birth,
                        phone,
                        address,
                        class_id,
                        guardian_id,
                        admission_date,
                        student_status,
                        nationality,
                        previous_school,
                        emergency_contact_name,
                        emergency_contact_phone,
                        emergency_contact_relationship,
                        registration_date

                    )

                    VALUES (

                        $1, $2, $3, $4, $5, $6,
                        $7, $8, $9, $10, $11, $12,
                        $13, $14, $15, $16, $17, $18

                    )

                    RETURNING student_id
                    `,
                    [

                        admission_number,
                        first_name,
                        middle_name || null,
                        last_name,
                        gender || null,
                        date_of_birth || null,
                        phone || null,
                        address || null,
                        class_id || null,
                        guardian_id || null,
                        admission_date || null,
                        student_status || 'Pending',
                        nationality || null,
                        previous_school || null,
                        emergency_contact_name || null,
                        emergency_contact_phone || null,
                        emergency_contact_relationship || null,
                        registration_date || new Date()

                    ]
                );


            const studentId =
                studentResult.rows[0]
                    .student_id;


            // Create approval record

            await client.query(
                `
                INSERT INTO record_approvals (

                    record_type,
                    record_id,
                    approval_status,
                    created_by,
                    created_at

                )

                VALUES (

                    'Student',
                    $1,
                    'Pending',
                    $2,
                    CURRENT_TIMESTAMP

                )
                `,
                [
                    studentId,
                    req.user.user_id
                ]
            );


            await client.query(
                'COMMIT'
            );


            res.status(201).json({

                message:
                    'Student registration submitted for approval',

                student_id:
                    studentId,

                status:
                    'Pending'

            });


        } catch (error) {

            await client.query(
                'ROLLBACK'
            );


            console.error(
                'Student registration error:',
                error
            );


            res.status(500).json({

                message:
                    'Failed to register student'

            });


        } finally {

            client.release();

        }

    }
);


// ============================================================
// UPDATE STUDENT — ADMINISTRATOR ONLY
// ============================================================

router.put(
    '/:student_id',
    authenticateToken,
    requireRoles(
        'Administrator'
    ),
    async (req, res) => {

        const studentId =
            parseInt(
                req.params.student_id
            );


        if (Number.isNaN(studentId)) {

            return res.status(400).json({

                message:
                    'Invalid student ID'

            });

        }


        const {

            admission_number,
            first_name,
            middle_name,
            last_name,
            gender,
            date_of_birth,
            phone,
            address,
            class_id,
            guardian_id,
            admission_date,
            student_status,
            nationality,
            previous_school,
            emergency_contact_name,
            emergency_contact_phone,
            emergency_contact_relationship

        } = req.body;


        // Required fields

        if (
            !admission_number ||
            !first_name ||
            !last_name
        ) {

            return res.status(400).json({

                message:
                    'Admission number, first name and last name are required'

            });

        }


        const client =
            await pool.connect();


        try {

            await client.query(
                'BEGIN'
            );


            // Check student exists

            const existing =
                await client.query(
                    `
                    SELECT student_id
                    FROM students
                    WHERE student_id = $1
                    `,
                    [
                        studentId
                    ]
                );


            if (
                existing.rows.length === 0
            ) {

                await client.query(
                    'ROLLBACK'
                );


                return res.status(404).json({

                    message:
                        'Student not found'

                });

            }


            // Check duplicate admission number

            const duplicate =
                await client.query(
                    `
                    SELECT student_id
                    FROM students
                    WHERE admission_number = $1
                    AND student_id <> $2
                    `,
                    [
                        admission_number,
                        studentId
                    ]
                );


            if (
                duplicate.rows.length > 0
            ) {

                await client.query(
                    'ROLLBACK'
                );


                return res.status(409).json({

                    message:
                        'Another student already uses this admission number'

                });

            }


            // Update student

            const result =
                await client.query(
                    `
                    UPDATE students

                    SET

                        admission_number = $1,
                        first_name = $2,
                        middle_name = $3,
                        last_name = $4,
                        gender = $5,
                        date_of_birth = $6,
                        phone = $7,
                        address = $8,
                        class_id = $9,
                        guardian_id = $10,
                        admission_date = $11,
                        student_status = $12,
                        nationality = $13,
                        previous_school = $14,
                        emergency_contact_name = $15,
                        emergency_contact_phone = $16,
                        emergency_contact_relationship = $17

                    WHERE student_id = $18

                    RETURNING *
                    `,
                    [

                        admission_number,
                        first_name,
                        middle_name || null,
                        last_name,
                        gender || null,
                        date_of_birth || null,
                        phone || null,
                        address || null,
                        class_id || null,
                        guardian_id || null,
                        admission_date || null,
                        student_status || 'Active',
                        nationality || null,
                        previous_school || null,
                        emergency_contact_name || null,
                        emergency_contact_phone || null,
                        emergency_contact_relationship || null,
                        studentId

                    ]
                );


            await client.query(
                'COMMIT'
            );


            res.json({

                message:
                    'Student updated successfully',

                student:
                    result.rows[0]

            });


        } catch (error) {

            await client.query(
                'ROLLBACK'
            );


            console.error(
                'Student update error:',
                error
            );


            res.status(500).json({

                message:
                    'Failed to update student'

            });


        } finally {

            client.release();

        }

    }
);

// ============================================================
// GET STUDENT FINANCE SUMMARY
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

                    CONCAT_WS(
                        ' ',
                        s.first_name,
                        s.middle_name,
                        s.last_name
                    ) AS student_name,

                    c.class_name,

                    s.arm,

                    COALESCE(
                        SUM(sf.amount_due),
                        0
                    ) AS total_expected,

                    COALESCE(
                        SUM(
                            COALESCE(p.total_paid, 0)
                        ),
                        0
                    ) AS total_paid,

                    COALESCE(
                        SUM(sf.amount_due),
                        0
                    )
                    -
                    COALESCE(
                        SUM(
                            COALESCE(p.total_paid, 0)
                        ),
                        0
                    ) AS total_balance

                FROM students s

                LEFT JOIN classes c
                    ON s.class_id = c.class_id

                LEFT JOIN student_fees sf
                    ON s.student_id = sf.student_id

                LEFT JOIN (
                    SELECT
                        student_fee_id,
                        SUM(amount_paid) AS total_paid
                    FROM payments
                    GROUP BY student_fee_id
                ) p
                    ON sf.student_fee_id =
                       p.student_fee_id

                WHERE
                    COALESCE(s.status, 'Active')
                    NOT IN (
                        'Withdrawn',
                        'Deleted'
                    )

                GROUP BY
                    s.student_id,
                    s.admission_number,
                    s.first_name,
                    s.middle_name,
                    s.last_name,
                    c.class_name,
                    s.arm

                ORDER BY
                    student_name

            `);


            const students =
                result.rows.map(student => {

                    const expected =
                        Number(
                            student.total_expected
                        );

                    const paid =
                        Number(
                            student.total_paid
                        );

                    const balance =
                        Number(
                            student.total_balance
                        );


                    let status =
                        'Unpaid';


                    if (
                        expected > 0 &&
                        balance <= 0
                    ) {

                        status =
                            'Paid';

                    } else if (
                        paid > 0
                    ) {

                        status =
                            'Partially Paid';

                    }


                    return {

                        ...student,

                        total_expected:
                            expected,

                        total_paid:
                            paid,

                        total_balance:
                            balance,

                        payment_status:
                            status

                    };

                });


            res.json({

                success: true,

                students

            });


        } catch (error) {

            console.error(
                'GET STUDENT FINANCE SUMMARY ERROR:',
                error
            );


            res.status(500).json({

                success: false,

                message:
                    'Failed to load student finance summary.',

                error:
                    error.message

            });

        }

    }
);


// ============================================================
// GET FEE CATEGORY SUMMARY
// ============================================================

router.get(
    '/fee-summary',
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

                    ft.fee_type_id,

                    ft.fee_name,

                    COALESCE(
                        SUM(sf.amount_due),
                        0
                    ) AS total_expected,

                    COALESCE(
                        SUM(
                            COALESCE(p.total_paid, 0)
                        ),
                        0
                    ) AS total_collected,

                    COALESCE(
                        SUM(sf.amount_due),
                        0
                    )
                    -
                    COALESCE(
                        SUM(
                            COALESCE(p.total_paid, 0)
                        ),
                        0
                    ) AS total_outstanding

                FROM fee_types ft

                LEFT JOIN student_fees sf
                    ON ft.fee_type_id =
                       sf.fee_type_id

                LEFT JOIN (
                    SELECT
                        student_fee_id,
                        SUM(amount_paid) AS total_paid
                    FROM payments
                    GROUP BY student_fee_id
                ) p
                    ON sf.student_fee_id =
                       p.student_fee_id

                WHERE
                    ft.is_active = TRUE

                GROUP BY
                    ft.fee_type_id,
                    ft.fee_name

                ORDER BY
                    ft.fee_name

            `);


            res.json({

                success: true,

                feeSummary:
                    result.rows.map(item => ({

                        ...item,

                        total_expected:
                            Number(
                                item.total_expected
                            ),

                        total_collected:
                            Number(
                                item.total_collected
                            ),

                        total_outstanding:
                            Number(
                                item.total_outstanding
                            )

                    }))

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
// EXPORT ROUTER
// ============================================================

module.exports = router;