const express = require('express');
const multer = require('multer');
const supabase = require('../Config/db');

const {
    authenticateToken,
    requireRoles,
    getRoleId,
    getSector,
    ROLE_IDS
} = require('../middleware/authMiddleware');

const router = express.Router();
const bcrypt = require('bcrypt');

/* =========================================================
   ROLE CONSTANTS
   ========================================================= */

const PROPRIETOR = ROLE_IDS.PROPRIETOR;       // 1
const ADMINISTRATOR = ROLE_IDS.ADMINISTRATOR; // 2
const FINANCE = ROLE_IDS.FINANCE;             // 3
const TEACHER = ROLE_IDS.TEACHER;             // 4
const STUDENT = ROLE_IDS.STUDENT;             // 5
const MANAGER = ROLE_IDS.MANAGER;             // 6

const MANAGEMENT_ROLES = [
    PROPRIETOR,
    ADMINISTRATOR,
    MANAGER
];

const FINANCE_ACCESS_ROLES = [
    PROPRIETOR,
    ADMINISTRATOR,
    FINANCE,
    MANAGER
];

/* =========================================================
   STUDENT CREDENTIAL HELPERS
   ========================================================= */

function slugPart(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[\s'\-]/g, '');
}

function generateUsername(firstName, lastName) {
    const base =
        `${slugPart(firstName)}.${slugPart(lastName)}` || 'student';
    return base;
}

function generatePassword(admissionNumber) {
    const digits = String(Math.floor(1000 + Math.random() * 9000));
    return `${admissionNumber}-${digits}`;
}

/* =========================================================
   MULTER
   ========================================================= */

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {

        const allowedTypes = [
            'image/jpeg',
            'image/png',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];

        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Unsupported file type.'));
        }
    }
});

/* =========================================================
   STORAGE UPLOAD HELPER

   Uploads to Supabase Storage and returns the public URL.

   Filename pattern:
       student_<id>_<fieldName>_<timestamp>.<ext>

   Photos go to bucket `student_photos` (folder `student-photos`).
   All other documents go to bucket `student_files`
   (folder is supplied by the caller).
   ========================================================= */

async function uploadToStorage(
    bucket,
    file,
    folder = '',
    studentId = 'new',
    fieldName = 'file'
) {
    if (!file) {
        return null;
    }

    /*
       Preserve the original extension (lowercased).
    */
    const original = String(file.originalname || '');
    const dotIndex = original.lastIndexOf('.');
    const ext = dotIndex >= 0
        ? original.slice(dotIndex).toLowerCase()
        : '';

    const timestamp = Date.now();

    const uniqueName =
        `student_${studentId}_${fieldName}_${timestamp}${ext}`;

    const filePath = folder
        ? `${folder}/${uniqueName}`
        : uniqueName;

    const { error } = await supabase.storage
        .from(bucket)
        .upload(filePath, file.buffer, {
            contentType: file.mimetype,
            upsert: false
        });

    if (error) {
        throw error;
    }

    const { data } = supabase.storage
        .from(bucket)
        .getPublicUrl(filePath);

    return data?.publicUrl || null;
}

/* =========================================================
   SECTOR / SCHOOL SECTION HELPERS
   ========================================================= */

function normalizeSector(sector) {
    return String(sector || '')
        .trim()
        .toLowerCase();
}


function normalizeSection(section) {
    return String(section || '')
        .trim()
        .toLowerCase();
}


function getPrimarySections() {
    return [
        'Nursery',
        'Primary'
    ];
}


function getSecondarySections() {
    return [
        'JSS',
        'SSS',
        'Secondary'
    ];
}


function getSectionsForSector(sector) {

    const normalizedSector = normalizeSector(sector);

    if (normalizedSector === 'primary') {
        return getPrimarySections();
    }

    if (normalizedSector === 'secondary') {
        return getSecondarySections();
    }

    return [];
}


function sectionBelongsToSector(
    schoolSection,
    sector
) {
    const normalizedSection =
        normalizeSection(schoolSection);

    const allowedSections =
        getSectionsForSector(sector);

    return allowedSections.some(section =>
        normalizeSection(section) === normalizedSection
    );
}


/* =========================================================
   MANAGER ACCESS
   ========================================================= */

/*
   IMPORTANT:

   Manager access is controlled ONLY by:

       role_id = 6
       sector = primary / secondary

   We do NOT trust ?sector= from the browser.

   Primary Manager:
       Nursery + Primary

   Secondary Manager:
       JSS + SSS + Secondary
*/

function managerCanAccessSection(
    user,
    schoolSection
) {
    if (getRoleId(user) !== MANAGER) {
        return false;
    }

    return sectionBelongsToSector(
        schoolSection,
        getSector(user)
    );
}


/* =========================================================
   STUDENT SECTOR VERIFICATION
   ========================================================= */

async function verifyStudentSector(
    user,
    studentId
) {

    const roleId = getRoleId(user);

    /*
       Proprietor and Administrator can access
       students in every sector.
    */
    if (
        roleId === PROPRIETOR ||
        roleId === ADMINISTRATOR
    ) {
        return true;
    }

    /*
       Only Managers use sector-based access here.
    */
    if (roleId !== MANAGER) {
        return false;
    }

    const { data: student, error } = await supabase
        .from('students')
        .select(`
            student_id,
            school_section,
            class_id,
            classes (
                class_id,
                class_name,
                school_section
            )
        `)
        .eq('student_id', studentId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    if (!student) {
        return false;
    }

    const studentSection =
        student.classes?.school_section ||
        student.school_section ||
        '';

    return managerCanAccessSection(
        user,
        studentSection
    );
}


/* =========================================================
   GET ALL STUDENTS
   ========================================================= */

router.get(
    '/',
    authenticateToken,
    async (req, res) => {

        try {

            const roleId =
                getRoleId(req.user);

            const userSector =
                normalizeSector(getSector(req.user));

            /*
               -------------------------------------------------
               MANAGER VALIDATION
               -------------------------------------------------
            */

            if (roleId === MANAGER) {

                if (
                    userSector !== 'primary' &&
                    userSector !== 'secondary'
                ) {
                    return res.status(403).json({
                        message:
                            'Manager sector is not configured correctly.'
                    });
                }
            }


            /*
               -------------------------------------------------
               STUDENT QUERY
               -------------------------------------------------

               We deliberately do NOT use the browser's
               ?sector= value to determine Manager access.

               The authenticated Manager's sector is authoritative.
            */

            let query = supabase
                .from('students')
                .select(`
                    *,
                    classes!inner (
                        class_id,
                        class_name,
                        arm,
                        school_section,
                        academic_year_id,
                        is_active
                    )
                `)
                .order('student_id', {
                    ascending: true
                });


            /*
               -------------------------------------------------
               MANAGER SECTOR FILTER
               -------------------------------------------------
            */

            if (roleId === MANAGER) {

                const allowedSections =
                    getSectionsForSector(userSector);

                if (!allowedSections.length) {
                    return res.status(403).json({
                        message:
                            'Manager sector is not configured correctly.'
                    });
                }

                /*
                   IMPORTANT:

                   Manager's own sector determines the query.

                   We do not compare against req.query.sector.
                */

                query = query.in(
                    'classes.school_section',
                    allowedSections
                );
            }


            /*
               -------------------------------------------------
               ADMIN / PROPRIETOR OPTIONAL FILTER
               -------------------------------------------------
            */

            if (
                roleId === PROPRIETOR ||
                roleId === ADMINISTRATOR
            ) {

                const requestedSector =
                    normalizeSector(req.query.sector);

                if (requestedSector === 'primary') {

                    query = query.in(
                        'classes.school_section',
                        getPrimarySections()
                    );

                } else if (
                    requestedSector === 'secondary'
                ) {

                    query = query.in(
                        'classes.school_section',
                        getSecondarySections()
                    );
                }
            }


            const {
                data: students,
                error: studentsError
            } = await query;


            if (studentsError) {
                console.error(
                    'STUDENTS QUERY ERROR:',
                    studentsError
                );

                return res.status(500).json({
                    message:
                        'Failed to load students.',
                    error:
                        studentsError.message
                });
            }


            /*
               -------------------------------------------------
               LOAD GUARDIANS
               -------------------------------------------------
            */

            const guardianIds =
                [
                    ...new Set(
                        (students || [])
                            .map(student =>
                                student.guardian_id
                            )
                            .filter(Boolean)
                    )
                ];


            let guardians = [];

            if (guardianIds.length) {

                const {
                    data,
                    error: guardianError
                } = await supabase
                    .from('guardians')
                    .select('*')
                    .in(
                        'guardian_id',
                        guardianIds
                    );

                if (guardianError) {

                    console.error(
                        'GUARDIANS QUERY ERROR:',
                        guardianError
                    );

                    return res.status(500).json({
                        message:
                            'Failed to load guardian information.',
                        error:
                            guardianError.message
                    });
                }

                guardians = data || [];
            }


            /*
               -------------------------------------------------
               CREATE GUARDIAN LOOKUP
               -------------------------------------------------
            */

            const guardianMap =
                new Map(
                    guardians.map(guardian => [
                        guardian.guardian_id,
                        guardian
                    ])
                );


            /*
               -------------------------------------------------
               FLATTEN RESPONSE
               -------------------------------------------------
            */

            const result =
                (students || []).map(student => {

                    const guardian =
                        guardianMap.get(
                            student.guardian_id
                        ) || null;

                    const classData =
                        student.classes || null;

                    return {

                        ...student,

                        class_name:
                            classData?.class_name || null,

                        arm:
                            classData?.arm || null,

                        school_section:
                            classData?.school_section ||
                            student.school_section ||
                            null,

                        academic_year_id:
                            classData?.academic_year_id ||
                            null,

                        class_is_active:
                            classData?.is_active ??
                            null,

                        guardian:
                            guardian,

                        guardian_name:
                guardian?.full_name || null,

                 guardian_relationship:
                guardian?.relationship || null,


                        guardian_phone:
                            guardian?.phone || null,

                        guardian_email:
                            guardian?.email || null,

                             guardian_address:
                guardian?.address || null,
                    };
                });


            return res.json(result);

        } catch (error) {

            console.error(
                'GET STUDENTS ERROR:',
                error
            );

            return res.status(500).json({
                message:
                    'Failed to load students.',
                error:
                    error.message
            });
        }
    }
);


/* =========================================================
   FINANCE STUDENT LIST
   ========================================================= */

router.get(
    '/finance',
    authenticateToken,
    requireRoles(
        PROPRIETOR,
        ADMINISTRATOR,
        FINANCE,
        MANAGER
    ),
    async (req, res) => {

        try {

            const roleId =
                getRoleId(req.user);

            const userSector =
                normalizeSector(
                    getSector(req.user)
                );

            const requestedSector =
                normalizeSector(
                    req.query.sector
                );


            /*
               Managers and Finance Officers are restricted
               to their own sector.
            */

            if (
                roleId === MANAGER ||
                roleId === FINANCE
            ) {

                if (
                    userSector !== 'primary' &&
                    userSector !== 'secondary'
                ) {
                    return res.status(403).json({
                        message:
                            'User sector is not configured correctly.'
                    });
                }

                /*
                   Ignore browser sector when it conflicts.
                   The authenticated user's sector is authoritative.
                */

                if (
                    requestedSector &&
                    requestedSector !== userSector
                ) {
                    return res.status(403).json({
                        message:
                            'Access denied. You cannot access students outside your sector.'
                    });
                }
            }


            let sectorToUse =
                requestedSector;


            if (
                roleId === MANAGER ||
                roleId === FINANCE
            ) {
                sectorToUse =
                    userSector;
            }


            let query =
                supabase
                    .from('students')
                    .select(`
                        *,
                        classes!inner (
                            class_id,
                            class_name,
                            arm,
                            school_section,
                            academic_year_id,
                            is_active
                        )
                    `)
                    .eq(
                        'student_status',
                        'Active'
                    )
                    .order(
                        'student_id',
                        {
                            ascending: true
                        }
                    );


            if (sectorToUse === 'primary') {

                query = query.in(
                    'classes.school_section',
                    getPrimarySections()
                );

            } else if (
                sectorToUse === 'secondary'
            ) {

                query = query.in(
                    'classes.school_section',
                    getSecondarySections()
                );
            }


            const {
                data: students,
                error
            } = await query;


            if (error) {

                console.error(
                    'FINANCE STUDENTS ERROR:',
                    error
                );

                return res.status(500).json({
                    message:
                        'Failed to load finance students.',
                    error:
                        error.message
                });
            }


            /*
               Load fee balances and payments.

               These are loaded separately so this route does
               not depend on any teachers backend.
            */

            const studentIds =
                (students || []).map(
                    student =>
                        student.student_id
                );


            let fees = [];
            let payments = [];


            if (studentIds.length) {

                const {
                    data: feeData,
                    error: feeError
                } = await supabase
                    .from('student_fees')
                    .select('*')
                    .in(
                        'student_id',
                        studentIds
                    );

                if (feeError) {

                    console.error(
                        'STUDENT FEES ERROR:',
                        feeError
                    );

                } else {

                    fees =
                        feeData || [];
                }


                const {
                    data: paymentData,
                    error: paymentError
                } = await supabase
                    .from('payments')
                    .select('*')
                    .in(
                        'student_id',
                        studentIds
                    );

                if (paymentError) {

                    console.error(
                        'STUDENT PAYMENTS ERROR:',
                        paymentError
                    );

                } else {

                    payments =
                        paymentData || [];
                }
            }


            const result =
                (students || []).map(student => {

                    const studentFees =
                        fees.filter(
                            fee =>
                                fee.student_id ===
                                student.student_id
                        );

                    const studentPayments =
                        payments.filter(
                            payment =>
                                payment.student_id ===
                                student.student_id
                        );

                    const totalFees =
                        studentFees.reduce(
                            (sum, fee) =>
                                sum +
                                Number(
                                    fee.amount ||
                                    fee.expected_amount ||
                                    0
                                ),
                            0
                        );

                    const totalPayments =
                        studentPayments.reduce(
                            (sum, payment) =>
                                sum +
                                Number(
                                    payment.amount || 0
                                ),
                            0
                        );

                    return {

                        ...student,

                        class_name:
                            student.classes?.class_name ||
                            null,

                        arm:
                            student.classes?.arm ||
                            null,

                        school_section:
                            student.classes?.school_section ||
                            student.school_section ||
                            null,

                        fees:
                            studentFees,

                        payments:
                            studentPayments,

                        total_fees:
                            totalFees,

                        total_paid:
                            totalPayments,

                        balance:
                            Math.max(
                                totalFees -
                                totalPayments,
                                0
                            )
                    };
                });


            return res.json(result);

        } catch (error) {

            console.error(
                'FINANCE STUDENTS ERROR:',
                error
            );

            return res.status(500).json({
                message:
                    'Failed to load finance students.',
                error:
                    error.message
            });
        }
    }
);


/* =========================================================
   GET SINGLE STUDENT
   ========================================================= */

router.get(
    '/:studentId',
    authenticateToken,
    async (req, res) => {

        try {

            const studentId =
                req.params.studentId;

            const roleId =
                getRoleId(req.user);


            /*
               Manager can only open students
               belonging to their own sector.
            */

            if (roleId === MANAGER) {

                const allowed =
                    await verifyStudentSector(
                        req.user,
                        studentId
                    );

                if (!allowed) {

                    return res.status(403).json({
                        message:
                            'Access denied. Student belongs to another sector.'
                    });
                }
            }


            const {
                data: student,
                error
            } = await supabase
                .from('students')
                .select(`
                    *,
                    classes (
                        class_id,
                        class_name,
                        arm,
                        school_section,
                        academic_year_id,
                        is_active
                    )
                `)
                .eq(
                    'student_id',
                    studentId
                )
                .maybeSingle();


            if (error) {

                console.error(
                    'GET SINGLE STUDENT ERROR:',
                    error
                );

                return res.status(500).json({
                    message:
                        'Failed to load student.',
                    error:
                        error.message
                });
            }


            if (!student) {

                return res.status(404).json({
                    message:
                        'Student not found.'
                });
            }


            /*
               Load guardian
            */

            let guardian = null;

            if (student.guardian_id) {

                const {
                    data: guardianData
                } = await supabase
                    .from('guardians')
                    .select('*')
                    .eq(
                        'guardian_id',
                        student.guardian_id
                    )
                    .maybeSingle();

                guardian =
                    guardianData || null;
            }


            return res.json({

                ...student,

                guardian

            });

        } catch (error) {

            console.error(
                'GET SINGLE STUDENT ERROR:',
                error
            );

            return res.status(500).json({
                message:
                    'Failed to load student.',
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   GET STUDENT CREDENTIALS
   ========================================================= */

router.get(
    '/:studentId/credentials',
    authenticateToken,
    requireRoles(
        PROPRIETOR,
        ADMINISTRATOR,
        MANAGER
    ),
    async (req, res) => {

        try {

            const studentId =
                req.params.studentId;

            const roleId =
                getRoleId(req.user);


            /*
               Manager can only read credentials of
               students in their own sector.
            */

            if (roleId === MANAGER) {

                const allowed =
                    await verifyStudentSector(
                        req.user,
                        studentId
                    );

                if (!allowed) {

                    return res.status(403).json({
                        message:
                            'Access denied. Student belongs to another sector.'
                    });
                }
            }


            const {
                data: userRow,
                error: userError
            } = await supabase
                .from('users')
                .select(`
                    user_id,
                    username,
                    portal_password_plain,
                    is_active,
                    role_id,
                    student_id
                `)
                .eq(
                    'student_id',
                    studentId
                )
                .eq(
                    'role_id',
                    STUDENT
                )
                .maybeSingle();


            if (userError) {

                console.error(
                    'GET STUDENT CREDENTIALS ERROR:',
                    userError
                );

                return res.status(500).json({
                    message:
                        'Failed to load credentials.',
                    error:
                        userError.message
                });
            }


            if (!userRow) {

                return res.status(404).json({
                    message:
                        'No user account is linked to this student.'
                });
            }


            return res.json({

                username:
                    userRow.username,

                password:
                    userRow.portal_password_plain ||
                    null,

                is_active:
                    userRow.is_active === true
            });

        } catch (error) {

            console.error(
                'GET STUDENT CREDENTIALS ERROR:',
                error
            );

            return res.status(500).json({
                message:
                    'Failed to load credentials.',
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   REGISTER STUDENT
   ========================================================= */

router.post(
    '/register',
    authenticateToken,
    requireRoles(
        PROPRIETOR,
        ADMINISTRATOR,
        MANAGER
    ),
    upload.fields([
        { name: 'student_photo',          maxCount: 1 },
        { name: 'result_file',            maxCount: 1 },
        { name: 'birth_certificate_file', maxCount: 1 },
        { name: 'testimonial_file',       maxCount: 1 },
        { name: 'transfer_file',          maxCount: 1 }
    ]),
    async (req, res) => {

        try {

            const roleId =
                getRoleId(req.user);

            const body =
                req.body || {};

            const classId =
                body.class_id;


            /*
               Load class first.
            */

            const {
                data: classData,
                error: classError
            } = await supabase
                .from('classes')
                .select(`
                    class_id,
                    class_name,
                    arm,
                    school_section,
                    academic_year_id,
                    is_active
                `)
                .eq(
                    'class_id',
                    classId
                )
                .maybeSingle();


            if (classError) {
                throw classError;
            }


            if (!classData) {

                return res.status(400).json({
                    message:
                        'Selected class was not found.'
                });
            }


            /*
               Manager may only register students
               in their own sector.
            */

            if (roleId === MANAGER) {

                if (
                    !managerCanAccessSection(
                        req.user,
                        classData.school_section
                    )
                ) {

                    return res.status(403).json({
                        message:
                            'Access denied. You cannot register a student outside your sector.'
                    });
                }
            }


            /*
               Academic year
            */

            const {
                data: academicYear
            } = await supabase
                .from('academic_years')
                .select('*')
                .eq(
                    'is_current',
                    true
                )
                .maybeSingle();


            /*
               Guardian
            */

            let guardianId =
                body.guardian_id ||
                null;


            if (!guardianId) {

                const guardianPayload = {

                    full_name:
                        body.guardian_first_name ||
                        body.guardian_name ||
                        null,

                    relationship:
                        body.guardian_relationship ||
                        null,

                    phone:
                        body.guardian_phone ||
                        null,

                    email:
                        body.guardian_email ||
                        null,

                    address:
                        body.guardian_address ||
                        null,

                };


                const {
                    data: guardian,
                    error: guardianError
                } = await supabase
                    .from('guardians')
                    .insert(
                        guardianPayload
                    )
                    .select()
                    .single();


                if (guardianError) {
                    throw guardianError;
                }

                guardianId =
                    guardian.guardian_id;
            }


            /*
               Upload files
            */

            const files =
                req.files || {};

            let photoUrl = null;
            let resultFileUrl = null;
            let birthCertificateUrl = null;
            let testimonialUrl = null;
            let transferFormUrl = null;


            if (files.student_photo?.[0]) {

                photoUrl =
                    await uploadToStorage(
                        'student_photos',
                        files.student_photo[0],
                        'student-photos',
                        body.admission_number || 'new',
                        'photo'
                    );
            }


            if (files.result_file?.[0]) {

                resultFileUrl =
                    await uploadToStorage(
                        'student_files',
                        files.result_file[0],
                        'results',
                        body.admission_number || 'new',
                        'result_file'
                    );
            }


            if (files.birth_certificate_file?.[0]) {

                birthCertificateUrl =
                    await uploadToStorage(
                        'student_files',
                        files.birth_certificate_file[0],
                        'birth-certificates',
                        body.admission_number || 'new',
                        'birth_certificate_file'
                    );
            }


            if (files.testimonial_file?.[0]) {

                testimonialUrl =
                    await uploadToStorage(
                        'student_files',
                        files.testimonial_file[0],
                        'testimonials',
                        body.admission_number || 'new',
                        'testimonial_file'
                    );
            }


            if (files.transfer_file?.[0]) {

                transferFormUrl =
                    await uploadToStorage(
                        'student_files',
                        files.transfer_file[0],
                        'transfer-forms',
                        body.admission_number || 'new',
                        'transfer_file'
                    );
            }


            /*
               Create student
            */

            const studentPayload = {

                first_name:
                    body.first_name,

                middle_name:
                    body.middle_name ||
                    null,

                last_name:
                    body.last_name,

                date_of_birth:
                    body.date_of_birth ||
                    null,

                gender:
                    body.gender ||
                    null,

                nationality:
                    body.nationality ||
                    null,

                admission_number:
                    body.admission_number ||
                    null,

                admission_date:
                    body.admission_date ||
                    null,

                class_id:
                    classId,

                guardian_id:
                    guardianId,

                student_status:
                    'Pending',

                previous_school:
                    body.previous_school ||
                    null,

                school_section:
                    classData.school_section,

                photo_url:
                    photoUrl,

                result_file_url:
                    resultFileUrl,

                birth_certificate_url:
                    birthCertificateUrl,

                testimonial_url:
                    testimonialUrl,

                transfer_form_url:
                    transferFormUrl,

                academic_year_id:
                    body.academic_year_id ||
                    classData.academic_year_id ||
                    academicYear?.academic_year_id ||
                    null
            };


            const {
                data: student,
                error: studentError
            } = await supabase
                .from('students')
                .insert(
                    studentPayload
                )
                .select()
                .single();


            if (studentError) {
                throw studentError;
            }


            /* =========================================================
               CREATE STUDENT USER ACCOUNT
               =========================================================

               Rules:
                 - username = first.last, with suffix 2, 3, ... on collision
                 - password = admission_number + "-" + 4 random digits
                 - role_id  = 5 (Student)
                 - sector   = student's class school_section
                 - is_active = false (activated on approval)
            */

            let generatedUsername = null;
            let generatedPassword = null;

            try {

                const baseUsername =
                    generateUsername(
                        student.first_name,
                        student.last_name
                    );

                let candidate =
                    baseUsername;

                let suffix =
                    2;

                let usernameFound =
                    false;

                /*
                   Probe up to 50 candidates.
                   This is intentionally a simple DB loop;
                   we will revisit if collision counts grow.
                */

                for (
                    let attempt = 0;
                    attempt < 50;
                    attempt++
                ) {

                    const {
                        data: existingUser,
                        error: lookupError
                    } = await supabase
                        .from('users')
                        .select('user_id')
                        .eq('username', candidate)
                        .maybeSingle();

                    if (lookupError) {
                        throw lookupError;
                    }

                    if (!existingUser) {
                        usernameFound = true;
                        break;
                    }

                    candidate =
                        `${baseUsername}${suffix}`;

                    suffix +=
                        1;
                }

                if (!usernameFound) {
                    throw new Error(
                        'Could not generate a unique username after 50 attempts.'
                    );
                }

                generatedUsername =
                    candidate;

                generatedPassword =
                    generatePassword(
                        student.admission_number
                    );

                const passwordHash =
                    await bcrypt.hash(
                        generatedPassword,
                        10
                    );

                const fullName =
                    [
                        student.first_name,
                        student.middle_name,
                        student.last_name
                    ]
                        .filter(Boolean)
                        .join(' ');

                const {
                    error: userInsertError
                } = await supabase
                    .from('users')
                    .insert({

                        username:
                            generatedUsername,

                        password_hash:
                            passwordHash,

                        portal_password_plain:
                            generatedPassword,

                        full_name:
                            fullName || null,

                        role_id:
                            STUDENT,

                        sector:
                            classData.school_section,

                        student_id:
                            student.student_id,

                        is_active:
                            false
                    });

                if (userInsertError) {

                    console.error(
                        'STUDENT USER INSERT ERROR:',
                        userInsertError
                    );

                    generatedUsername = null;
                    generatedPassword = null;
                }

            } catch (userError) {

                console.error(
                    'STUDENT USER CREATION ERROR:',
                    userError
                );

                generatedUsername = null;
                generatedPassword = null;
            }


            /*
               Record approval
            */

            const {
                error: approvalError
            } = await supabase
                .from('record_approvals')
                .insert({

                    record_type:
                        'student',

                    record_id:
                        student.student_id,

                    school_section:
                        classData.school_section,

                    approval_status:
                        'Pending',

                    created_by:
                        req.user.user_id ||
                        null
                });


            if (approvalError) {

                console.error(
                    'APPROVAL CREATION ERROR:',
                    approvalError
                );

                /*
                   Do not undo successful student creation
                   merely because approval logging failed.
                */
            }


            return res.status(201).json({

                message:
                    'Student registered successfully.',

                student,

                credentials:
                    generatedUsername
                        ? {
                            username:
                                generatedUsername,

                            password:
                                generatedPassword
                        }
                        : null,

                credentials_warning:
                    generatedUsername
                        ? null
                        : 'Student record was created, but the user account could not be created. Please create it manually.'
            });

        } catch (error) {

            console.error(
                'REGISTER STUDENT ERROR:',
                error
            );

            return res.status(500).json({

                message:
                    'Failed to register student.',

                error:
                    error.message

            });
        }
    }
);


/* =========================================================
   UPDATE STUDENT WITH PHOTO
   ========================================================= */

router.put(
    '/:studentId/update-with-photo',
    authenticateToken,
    requireRoles(
        PROPRIETOR,
        ADMINISTRATOR,
        MANAGER
    ),
    upload.single('photo'),
    async (req, res) => {

        try {

            const studentId =
                req.params.studentId;

            const roleId =
                getRoleId(req.user);


            /*
               Get existing student
            */

            const {
                data: existingStudent,
                error: existingError
            } = await supabase
                .from('students')
                .select(`
                    *,
                    classes (
                        class_id,
                        class_name,
                        school_section
                    )
                `)
                .eq(
                    'student_id',
                    studentId
                )
                .maybeSingle();


            if (existingError) {
                throw existingError;
            }


            if (!existingStudent) {

                return res.status(404).json({
                    message:
                        'Student not found.'
                });
            }


            /*
               Manager must own existing student sector.
            */

            if (roleId === MANAGER) {

                const existingSection =
                    existingStudent.classes
                        ?.school_section ||
                    existingStudent.school_section ||
                    '';

                if (
                    !managerCanAccessSection(
                        req.user,
                        existingSection
                    )
                ) {

                    return res.status(403).json({
                        message:
                            'Access denied. Student belongs to another sector.'
                    });
                }
            }


            /*
               Determine class.
            */

            let classId =
                req.body.class_id ||
                existingStudent.class_id;


            let newClass =
                existingStudent.classes;


            if (
                req.body.class_id &&
                Number(req.body.class_id) !==
                Number(existingStudent.class_id)
            ) {

                const {
                    data: classData,
                    error: classError
                } = await supabase
                    .from('classes')
                    .select(`
                        class_id,
                        class_name,
                        arm,
                        school_section,
                        academic_year_id,
                        is_active
                    `)
                    .eq(
                        'class_id',
                        req.body.class_id
                    )
                    .maybeSingle();


                if (classError) {
                    throw classError;
                }


                if (!classData) {

                    return res.status(400).json({
                        message:
                            'Selected class was not found.'
                    });
                }


                newClass =
                    classData;


                if (roleId === MANAGER) {

                    if (
                        !managerCanAccessSection(
                            req.user,
                            classData.school_section
                        )
                    ) {

                        return res.status(403).json({
                            message:
                                'Access denied. You cannot move a student outside your sector.'
                        });
                    }
                }
            }


            /*
               Build safe update object.
            */

            const allowedFields = [

                'first_name',
                'middle_name',
                'last_name',
                'date_of_birth',
                'gender',
                'nationality',
                'admission_number',
                'admission_date',
                'class_id',
                'guardian_id',
                'student_status',
                'previous_school',
                'academic_year_id'

            ];


            const studentUpdate = {};


            for (
                const field of allowedFields
            ) {

                if (
                    req.body[field] !==
                    undefined
                ) {

                    studentUpdate[field] =
                        req.body[field] === ''
                            ? null
                            : req.body[field];
                }
            }


            /*
               Always synchronize school_section
               with the student's class.
            */

            if (newClass) {

                studentUpdate.school_section =
                    newClass.school_section;
            }


            /*
               Upload replacement photo.
            */

            if (req.file) {

                const photoUrl =
                    await uploadToStorage(
                        'student_photos',
                        req.file,
                        'student-photos',
                        studentId,
                        'photo'
                    );

                studentUpdate.photo_url =
                    photoUrl;
            }


            const {
                data: updatedStudent,
                error: updateError
            } = await supabase
                .from('students')
                .update(
                    studentUpdate
                )
                .eq(
                    'student_id',
                    studentId
                )
                .select()
                .single();


            if (updateError) {
                throw updateError;
            }


            return res.json({

                message:
                    'Student updated successfully.',

                student:
                    updatedStudent

            });

        } catch (error) {

            console.error(
                'UPDATE STUDENT WITH PHOTO ERROR:',
                error
            );

            return res.status(500).json({

                message:
                    'Failed to update student.',

                error:
                    error.message

            });
        }
    }
);


/* =========================================================
   UPDATE STUDENT
   ========================================================= */

router.put(
    '/:studentId',
    authenticateToken,
    requireRoles(
        PROPRIETOR,
        ADMINISTRATOR,
        MANAGER
    ),
    async (req, res) => {

        try {

            const studentId =
                req.params.studentId;

            const roleId =
                getRoleId(req.user);


            /*
               Get existing student
            */

            const {
                data: existingStudent,
                error: existingError
            } = await supabase
                .from('students')
                .select(`
                    *,
                    classes (
                        class_id,
                        class_name,
                        school_section
                    )
                `)
                .eq(
                    'student_id',
                    studentId
                )
                .maybeSingle();


            if (existingError) {
                throw existingError;
            }


            if (!existingStudent) {

                return res.status(404).json({
                    message:
                        'Student not found.'
                });
            }


            /*
               Existing sector check
            */

            if (roleId === MANAGER) {

                const existingSection =
                    existingStudent.classes
                        ?.school_section ||
                    existingStudent.school_section ||
                    '';

                if (
                    !managerCanAccessSection(
                        req.user,
                        existingSection
                    )
                ) {

                    return res.status(403).json({
                        message:
                            'Access denied. Student belongs to another sector.'
                    });
                }
            }


            /*
               Determine target class.
            */

            const targetClassId =
                req.body.class_id ||
                existingStudent.class_id;


            const {
                data: targetClass,
                error: targetClassError
            } = await supabase
                .from('classes')
                .select(`
                    class_id,
                    class_name,
                    arm,
                    school_section,
                    academic_year_id,
                    is_active
                `)
                .eq(
                    'class_id',
                    targetClassId
                )
                .maybeSingle();


            if (targetClassError) {
                throw targetClassError;
            }


            if (!targetClass) {

                return res.status(400).json({
                    message:
                        'Selected class was not found.'
                });
            }


            /*
               Manager cannot move student outside
               own sector.
            */

            if (roleId === MANAGER) {

                if (
                    !managerCanAccessSection(
                        req.user,
                        targetClass.school_section
                    )
                ) {

                    return res.status(403).json({
                        message:
                            'Access denied. You cannot move a student outside your sector.'
                    });
                }
            }


            /*
               Safe update fields.
            */

            const allowedFields = [

                'first_name',
                'middle_name',
                'last_name',
                'date_of_birth',
                'gender',
                'nationality',
                'admission_number',
                'admission_date',
                'class_id',
                'guardian_id',
                'student_status',
                'previous_school',
                'academic_year_id',
                'photo_url'

            ];


            const studentUpdate = {};


            for (
                const field of allowedFields
            ) {

                if (
                    req.body[field] !==
                    undefined
                ) {

                    studentUpdate[field] =
                        req.body[field] === ''
                            ? null
                            : req.body[field];
                }
            }


            /*
               Keep school_section synchronized
               with the class.
            */

            studentUpdate.class_id =
                targetClass.class_id;

            studentUpdate.school_section =
                targetClass.school_section;


            const {
                data: updatedStudent,
                error: updateError
            } = await supabase
                .from('students')
                .update(
                    studentUpdate
                )
                .eq(
                    'student_id',
                    studentId
                )
                .select()
                .single();


            if (updateError) {
                throw updateError;
            }


            return res.json({

                message:
                    'Student updated successfully.',

                student:
                    updatedStudent

            });

        } catch (error) {

            console.error(
                'UPDATE STUDENT ERROR:',
                error
            );

            return res.status(500).json({

                message:
                    'Failed to update student.',

                error:
                    error.message

            });
        }
    }
);


/* =========================================================
   REAPPROVE STUDENT
   ========================================================= */

router.put(
    '/:studentId/reapprove',
    authenticateToken,
    requireRoles(
        PROPRIETOR,
        ADMINISTRATOR,
        MANAGER
    ),
    async (req, res) => {

        try {

            const studentId =
                req.params.studentId;

            const roleId =
                getRoleId(req.user);


            /*
               Get student and class
            */

            const {
                data: student,
                error: studentError
            } = await supabase
                .from('students')
                .select(`
                    *,
                    classes (
                        class_id,
                        class_name,
                        school_section
                    )
                `)
                .eq(
                    'student_id',
                    studentId
                )
                .maybeSingle();


            if (studentError) {
                throw studentError;
            }


            if (!student) {

                return res.status(404).json({
                    message:
                        'Student not found.'
                });
            }


            /*
               Manager sector restriction
            */

            if (roleId === MANAGER) {

                const section =
                    student.classes
                        ?.school_section ||
                    student.school_section ||
                    '';

                if (
                    !managerCanAccessSection(
                        req.user,
                        section
                    )
                ) {

                    return res.status(403).json({
                        message:
                            'Access denied. Student belongs to another sector.'
                    });
                }
            }


            /*
               Set student back to Pending.
            */

            const {
                data: updatedStudent,
                error: updateError
            } = await supabase
                .from('students')
                .update({
                    student_status:
                        'Pending'
                })
                .eq(
                    'student_id',
                    studentId
                )
                .select()
                .single();


            if (updateError) {
                throw updateError;
            }


            /*
               Check for existing approval.
            */

            const {
                data: existingApproval,
                error: approvalLookupError
            } = await supabase
                .from('record_approvals')
                .select('*')
                .eq(
                    'record_type',
                    'student'
                )
                .eq(
                    'record_id',
                    studentId
                )
                .maybeSingle();


            if (approvalLookupError) {

                console.error(
                    'APPROVAL LOOKUP ERROR:',
                    approvalLookupError
                );

            } else if (existingApproval) {

                const {
                    error: approvalUpdateError
                } = await supabase
                    .from('record_approvals')
                    .update({

                        approval_status:
                            'Pending',

                        created_by:
                            req.user.user_id ||
                            null,

                        created_at:
                            new Date().toISOString()

                    })
                    .eq(
                        'id',
                        existingApproval.id
                    );


                if (approvalUpdateError) {

                    console.error(
                        'APPROVAL UPDATE ERROR:',
                        approvalUpdateError
                    );
                }

            } else {

                const {
                    error: approvalInsertError
                } = await supabase
                    .from('record_approvals')
                    .insert({

                        record_type:
                            'student',

                        record_id:
                            studentId,

                        school_section:
                            student.classes
                                ?.school_section ||
                            student.school_section ||
                            null,

                        approval_status:
                            'Pending',

                        created_by:
                            req.user.user_id ||
                            null

                    });


                if (approvalInsertError) {

                    console.error(
                        'APPROVAL INSERT ERROR:',
                        approvalInsertError
                    );
                }
            }


            return res.json({

                message:
                    'Student sent for approval again.',

                student:
                    updatedStudent

            });

        } catch (error) {

            console.error(
                'REAPPROVE STUDENT ERROR:',
                error
            );

            return res.status(500).json({

                message:
                    'Failed to reapprove student.',

                error:
                    error.message

            });
        }
    }
);


/* =========================================================
   EXPORT
   ========================================================= */

module.exports = router;