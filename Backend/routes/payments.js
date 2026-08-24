const express = require('express');
const supabase = require('../Config/db');

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
    requireRoles('Manager', 'Administrator', 'Proprietor'),
    async (req, res) => {
        try {

            const { data, error } = await supabase
                .from('fee_types')
                .select(`
                    fee_type_id,
                    fee_name,
                    description,
                    is_active,
                    created_at
                `)
                .eq('is_active', true)
                .order('fee_name');

            if (error) throw error;

            res.json({
                success: true,
                feeTypes: data
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
// ============================================================
router.get(
    '/students',
    authenticateToken,
    requireRoles('Manager', 'Administrator', 'Proprietor'),
    async (req, res) => {

        try {

            // ------------------------------------------------
            // GET ACTIVE STUDENTS
            // ------------------------------------------------
            const {
                data: studentsData,
                error: studentsError
            } = await supabase
                .from('students')
                .select(`
                    student_id,
                    admission_number,
                    first_name,
                    middle_name,
                    last_name,
                    student_status,
                    classes:class_id (
                        class_name,
                        arm
                    )
                `)
                .eq('student_status', 'Active')
                .order('first_name');

            if (studentsError) {
                throw studentsError;
            }


            // ------------------------------------------------
            // GET ALL STUDENT FEE BALANCES
            // ------------------------------------------------
            const {
                data: balancesData,
                error: balancesError
            } = await supabase
                .from('student_fee_balances')
                .select('*');

            if (balancesError) {
                throw balancesError;
            }


            // ------------------------------------------------
            // COMBINE DATA
            // ------------------------------------------------
            const students =
                studentsData.map(student => {

                    const studentBalances =
                        balancesData.filter(
                            balance =>
                                Number(balance.student_id) ===
                                Number(student.student_id)
                        );


                    const total_expected =
                        studentBalances.reduce(
                            (sum, balance) =>
                                sum +
                                Number(balance.amount_due || 0),
                            0
                        );


                    const total_paid =
                        studentBalances.reduce(
                            (sum, balance) =>
                                sum +
                                Number(balance.total_paid || 0),
                            0
                        );


                    const total_balance =
                        studentBalances.reduce(
                            (sum, balance) =>
                                sum +
                                Number(balance.balance || 0),
                            0
                        );


                    const paid_fees =
                        studentBalances.filter(
                            balance =>
                                balance.payment_status === 'Paid'
                        ).length;


                    const partially_paid_fees =
                        studentBalances.filter(
                            balance =>
                                balance.payment_status === 'Partially Paid'
                        ).length;


                    const unpaid_fees =
                        studentBalances.filter(
                            balance =>
                                balance.payment_status === 'Unpaid'
                        ).length;


                    return {

                        student_id:
                            student.student_id,

                        admission_number:
                            student.admission_number,

                        student_name:
                            [
                                student.first_name,
                                student.middle_name,
                                student.last_name
                            ]
                            .filter(Boolean)
                            .join(' ')
                            .trim(),

                        class_name:
                            student.classes?.class_name ||
                            null,

                        arm:
                            student.classes?.arm ||
                            null,

                        total_expected,

                        total_paid,

                        total_balance,

                        fee_count:
                            studentBalances.length,

                        paid_fees,

                        partially_paid_fees,

                        unpaid_fees

                    };

                });


            res.json({
                success: true,
                students
            });


        } catch (error) {

            console.error(
                'GET FINANCE STUDENTS ERROR:',
                error
            );

            res.status(500).json({
                success: false,
                message:
                    'Failed to load admitted students.',
                error:
                    error.message
            });

        }

    }
);


// ============================================================
// GET ONE STUDENT'S COMPLETE FINANCE RECORD
// ============================================================
router.get(
    '/student/:studentId',
    authenticateToken,
    requireRoles('Manager', 'Administrator', 'Proprietor'),
    async (req, res) => {

        try {

            const studentId =
                Number(req.params.studentId);


            // ------------------------------------------------
            // VALIDATE STUDENT ID
            // ------------------------------------------------
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
            // GET STUDENT INFORMATION
            // ------------------------------------------------
            const {
                data: student,
                error: studentError
            } = await supabase
                .from('students')
                .select(`
                    student_id,
                    admission_number,
                    first_name,
                    middle_name,
                    last_name,
                    student_status,
                    classes:class_id (
                        class_name,
                        arm
                    )
                `)
                .eq('student_id', studentId)
                .single();


            if (studentError || !student) {

                console.error(
                    'STUDENT NOT FOUND:',
                    studentError
                );

                return res.status(404).json({
                    success: false,
                    message: 'Student not found.'
                });

            }


            // ------------------------------------------------
            // FORMAT STUDENT NAME
            // ------------------------------------------------
            const studentName =
                [
                    student.first_name,
                    student.middle_name,
                    student.last_name
                ]
                .filter(Boolean)
                .join(' ')
                .trim();


            const formattedStudent = {

                student_id:
                    student.student_id,

                admission_number:
                    student.admission_number,

                student_name:
                    studentName,

                class_name:
                    student.classes?.class_name ||
                    null,

                arm:
                    student.classes?.arm ||
                    null,

                student_status:
                    student.student_status

            };


            // ------------------------------------------------
            // GET STUDENT FEES
            // ------------------------------------------------
            const {
                data: fees,
                error: feesError
            } = await supabase
                .from('student_fee_balances')
                .select('*')
                .eq('student_id', studentId)
                .order('fee_name')
                .order('academic_year')
                .order('term_name');


            if (feesError) {

                console.error(
                    'FEES ERROR:',
                    feesError
                );

            }


            // ------------------------------------------------
            // GET STUDENT FEE RECORDS
            //
            // IMPORTANT:
            // payments does NOT contain student_id.
            // student_fees contains student_id.
            // ------------------------------------------------
            const {
                data: studentFees,
                error: studentFeesError
            } = await supabase
                .from('student_fees')
                .select(`
                    student_fee_id,
                    student_id,
                    fee_type_id,
                    amount_due,
                    amount_paid,
                    payment_status
                `)
                .eq('student_id', studentId);


            if (studentFeesError) {

                console.error(
                    'STUDENT FEES ERROR:',
                    studentFeesError
                );

            }


            // ------------------------------------------------
// GET PAYMENT HISTORY
// ------------------------------------------------
// payment_history already contains the student's
// admission number and fee name, so we can query
// the view directly without rebuilding the joins.
// ------------------------------------------------

let payments = [];

const {
    data: paymentData,
    error: paymentsError
} = await supabase
    .from('payment_history')
    .select(`
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
    `)
    .eq(
        'admission_number',
        student.admission_number
    )
    .order(
        'payment_date',
        {
            ascending: false
        }
    )
    .order(
        'payment_id',
        {
            ascending: false
        }
    );

if (paymentsError) {

    console.error(
        'PAYMENT HISTORY ERROR:',
        paymentsError
    );

    throw paymentsError;

}

payments = paymentData || [];


            // ------------------------------------------------
            // GET FEE NAMES FOR PAYMENTS
            // ------------------------------------------------
            const paymentsWithFeeNames = [];


            for (
                const payment of payments
            ) {

                const {
                    data: studentFee,
                    error: studentFeeError
                } = await supabase
                    .from('student_fees')
                    .select(`
                        fee_type_id
                    `)
                    .eq(
                        'student_fee_id',
                        payment.student_fee_id
                    )
                    .single();


                let feeName = null;


                if (
                    !studentFeeError &&
                    studentFee
                ) {

                    const {
                        data: feeType,
                        error: feeTypeError
                    } = await supabase
                        .from('fee_types')
                        .select(`
                            fee_name
                        `)
                        .eq(
                            'fee_type_id',
                            studentFee.fee_type_id
                        )
                        .single();


                    if (
                        !feeTypeError &&
                        feeType
                    ) {

                        feeName =
                            feeType.fee_name;

                    }

                }


                paymentsWithFeeNames.push({

                    ...payment,

                    fee_name:
                        feeName

                });

            }


            // ------------------------------------------------
            // CALCULATE TOTALS
            // ------------------------------------------------
            const total_expected =
                (fees || []).reduce(
                    (sum, fee) =>
                        sum +
                        Number(
                            fee.amount_due || 0
                        ),
                    0
                );


            const total_paid =
                (fees || []).reduce(
                    (sum, fee) =>
                        sum +
                        Number(
                            fee.total_paid || 0
                        ),
                    0
                );


            const total_balance =
                (fees || []).reduce(
                    (sum, fee) =>
                        sum +
                        Number(
                            fee.balance || 0
                        ),
                    0
                );


            // ------------------------------------------------
            // RESPONSE
            // ------------------------------------------------
            res.json({

                success: true,

                student:
                    formattedStudent,

                fees:
                    fees || [],

                payments:
                    paymentsWithFeeNames,

                totals: {

                    total_expected,

                    total_paid,

                    total_balance

                }

            });


        } catch (error) {

            console.error(
                'GET STUDENT FINANCE ERROR:',
                error
            );

            res.status(500).json({

                success: false,

                message:
                    'Failed to load student finance records.',

                error:
                    error.message

            });

        }

    }
);


// ============================================================
// GET STUDENT FEE BALANCES
// ============================================================
router.get(
    '/balances',
    authenticateToken,
    requireRoles('Manager', 'Administrator', 'Proprietor'),
    async (req, res) => {

        try {

            const {
                data,
                error
            } = await supabase
                .from('student_fee_balances')
                .select('*')
                .order('student_name')
                .order('fee_name');


            if (error) {
                throw error;
            }


            res.json({

                success: true,

                balances:
                    data

            });


        } catch (error) {

            console.error(
                'GET FEE BALANCES ERROR:',
                error
            );

            res.status(500).json({

                success: false,

                message:
                    'Failed to load student fee balances.',

                error:
                    error.message

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
    requireRoles('Manager', 'Administrator', 'Proprietor'),
    async (req, res) => {

        try {

            const {
                data,
                error
            } = await supabase
                .from('payment_history')
                .select('*')
                .order(
                    'payment_date',
                    {
                        ascending: false
                    }
                )
                .order(
                    'payment_id',
                    {
                        ascending: false
                    }
                );


            if (error) {
                throw error;
            }


            res.json({

                success: true,

                payments:
                    data

            });


        } catch (error) {

            console.error(
                'GET PAYMENT HISTORY ERROR:',
                error
            );

            res.status(500).json({

                success: false,

                message:
                    'Failed to load payment history.',

                error:
                    error.message

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
    requireRoles('Manager', 'Administrator', 'Proprietor'),
    async (req, res) => {

        try {

            const {
                data: balances,
                error: balancesError
            } = await supabase
                .from('student_fee_balances')
                .select(`
                    amount_due,
                    total_paid,
                    balance,
                    payment_status
                `);


            if (balancesError) {
                throw balancesError;
            }


            const summary = {

                total_expected:
                    balances.reduce(
                        (sum, balance) =>
                            sum +
                            Number(
                                balance.amount_due || 0
                            ),
                        0
                    ),

                total_collected:
                    balances.reduce(
                        (sum, balance) =>
                            sum +
                            Number(
                                balance.total_paid || 0
                            ),
                        0
                    ),

                total_outstanding:
                    balances.reduce(
                        (sum, balance) =>
                            sum +
                            Number(
                                balance.balance || 0
                            ),
                        0
                    ),

                total_fee_records:
                    balances.length,

                paid_records:
                    balances.filter(
                        balance =>
                            balance.payment_status ===
                            'Paid'
                    ).length,

                partially_paid_records:
                    balances.filter(
                        balance =>
                            balance.payment_status ===
                            'Partially Paid'
                    ).length,

                unpaid_records:
                    balances.filter(
                        balance =>
                            balance.payment_status ===
                            'Unpaid'
                    ).length

            };


            // ------------------------------------------------
            // TOTAL ACTIVE STUDENTS
            // ------------------------------------------------
            const {
                count: total_students,
                error: studentsError
            } = await supabase
                .from('students')
                .select(
                    '*',
                    {
                        count: 'exact',
                        head: true
                    }
                )
                .eq(
                    'student_status',
                    'Active'
                );


            if (studentsError) {
                throw studentsError;
            }


            res.json({

                success: true,

                summary: {

                    ...summary,

                    total_students

                }

            });


        } catch (error) {

            console.error(
                'FINANCE SUMMARY ERROR:',
                error
            );

            res.status(500).json({

                success: false,

                message:
                    'Failed to load finance summary.',

                error:
                    error.message

            });

        }

    }
);


// ============================================================
// GET FINANCE SUMMARY BY FEE CATEGORY
// ============================================================
router.get(
    '/summary-by-fee',
    authenticateToken,
    requireRoles('Manager', 'Administrator', 'Proprietor'),
    async (req, res) => {

        try {

            const {
                data,
                error
            } = await supabase
                .from('student_fee_balances')
                .select(`
                    fee_name,
                    amount_due,
                    total_paid,
                    balance,
                    payment_status
                `);


            if (error) {
                throw error;
            }


            const groupedData =
                data.reduce(
                    (acc, item) => {

                        if (
                            !acc[item.fee_name]
                        ) {

                            acc[item.fee_name] = {

                                fee_name:
                                    item.fee_name,

                                total_expected:
                                    0,

                                total_collected:
                                    0,

                                total_outstanding:
                                    0,

                                total_records:
                                    0,

                                paid_records:
                                    0,

                                partially_paid_records:
                                    0,

                                unpaid_records:
                                    0

                            };

                        }


                        const group =
                            acc[item.fee_name];


                        group.total_expected +=
                            Number(
                                item.amount_due || 0
                            );


                        group.total_collected +=
                            Number(
                                item.total_paid || 0
                            );


                        group.total_outstanding +=
                            Number(
                                item.balance || 0
                            );


                        group.total_records +=
                            1;


                        if (
                            item.payment_status ===
                            'Paid'
                        ) {

                            group.paid_records +=
                                1;

                        } else if (
                            item.payment_status ===
                            'Partially Paid'
                        ) {

                            group.partially_paid_records +=
                                1;

                        } else if (
                            item.payment_status ===
                            'Unpaid'
                        ) {

                            group.unpaid_records +=
                                1;

                        }


                        return acc;

                    },
                    {}
                );


            const categories =
                Object.values(
                    groupedData
                ).sort(
                    (a, b) =>
                        a.fee_name.localeCompare(
                            b.fee_name
                        )
                );


            res.json({

                success: true,

                categories

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
    requireRoles('Manager', 'Administrator'),
    async (req, res) => {

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

                    message:
                        'A valid student is required.'

                });

            }


            if (
                !Number.isInteger(studentFeeId) ||
                studentFeeId <= 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        'A valid student fee is required.'

                });

            }


            if (
                !Number.isFinite(amount) ||
                amount <= 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        'Payment amount must be greater than zero.'

                });

            }


            // ------------------------------------------------
            // VERIFY STUDENT
            // ------------------------------------------------
            const {
                data: student,
                error: studentError
            } = await supabase
                .from('students')
                .select(`
                    student_id,
                    student_status
                `)
                .eq(
                    'student_id',
                    studentId
                )
                .eq(
                    'student_status',
                    'Active'
                )
                .single();


            if (
                studentError ||
                !student
            ) {

                return res.status(404).json({

                    success: false,

                    message:
                        'Active student not found.'

                });

            }


            // ------------------------------------------------
            // VERIFY STUDENT FEE
            // ------------------------------------------------
            const {
                data: fee,
                error: feeError
            } = await supabase
                .from('student_fees')
                .select(`
                    student_fee_id,
                    student_id,
                    amount_due,
                    fee_types:fee_type_id (
                        fee_name
                    )
                `)
                .eq(
                    'student_fee_id',
                    studentFeeId
                )
                .eq(
                    'student_id',
                    studentId
                )
                .single();


            if (
                feeError ||
                !fee
            ) {

                return res.status(404).json({

                    success: false,

                    message:
                        'Student fee record not found.'

                });

            }


            // ------------------------------------------------
            // CURRENT PAYMENTS
            // ------------------------------------------------
            const {
                data: payments,
                error: paymentsError
            } = await supabase
                .from('payments')
                .select(`
                    amount_paid
                `)
                .eq(
                    'student_fee_id',
                    studentFeeId
                );


            if (paymentsError) {
                throw paymentsError;
            }


            const totalPaid =
                payments.reduce(
                    (sum, payment) =>
                        sum +
                        Number(
                            payment.amount_paid || 0
                        ),
                    0
                );


            const amountDue =
                Number(
                    fee.amount_due
                );


            const balance =
                amountDue -
                totalPaid;


            // ------------------------------------------------
            // PREVENT OVERPAYMENT
            // ------------------------------------------------
            if (
                amount > balance
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        `Payment exceeds the outstanding balance. Outstanding balance is Le${balance.toFixed(2)}.`

                });

            }


            // ------------------------------------------------
            // INSERT PAYMENT
            //
            // IMPORTANT:
            // payments is linked to student through
            // student_fee_id.
            //
            // Therefore student_id is NOT inserted here.
            // ------------------------------------------------
            const {
                data: payment,
                error: insertError
            } = await supabase
                .from('payments')
                .insert({

                    student_fee_id:
                        studentFeeId,

                    amount_paid:
                        amount,

                    payment_date:
                        payment_date ||
                        new Date().toISOString(),

                    payment_method:
                        payment_method ||
                        null,

                    payment_slip_number:
                        payment_slip_number ||
                        null,

                    bank_reference:
                        bank_reference ||
                        null,

                    purpose:
                        purpose ||
                        fee.fee_types?.fee_name ||
                        null,

                    notes:
                        notes ||
                        null,

                    recorded_by:
                        req.user.user_id

                })
                .select()
                .single();


            if (insertError) {
                throw insertError;
            }


            // ------------------------------------------------
            // NEW BALANCE
            // ------------------------------------------------
            const newTotalPaid =
                totalPaid +
                amount;


            const newBalance =
                amountDue -
                newTotalPaid;


            let paymentStatus =
                'Unpaid';


            if (
                newTotalPaid >=
                amountDue
            ) {

                paymentStatus =
                    'Paid';

            } else if (
                newTotalPaid > 0
            ) {

                paymentStatus =
                    'Partially Paid';

            }


            // ------------------------------------------------
            // UPDATE STUDENT FEE STATUS
            // ------------------------------------------------
            const {
                error: updateError
            } = await supabase
                .from('student_fees')
                .update({

                    amount_paid:
                        newTotalPaid,

                    payment_status:
                        paymentStatus

                })
                .eq(
                    'student_fee_id',
                    studentFeeId
                );


            if (updateError) {
                throw updateError;
            }


            // ------------------------------------------------
            // SUCCESS
            // ------------------------------------------------
            res.status(201).json({

                success: true,

                message:
                    'Payment recorded successfully.',

                payment,

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

        }

    }
);


module.exports = router;