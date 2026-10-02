const jwt = require('jsonwebtoken');

/*
|--------------------------------------------------------------------------
| ROLE IDs
|--------------------------------------------------------------------------
| These must match the user_roles table.
|
| 1 = Proprietor
| 2 = Administrator
| 3 = Finance
| 4 = Teacher
| 5 = Student
| 6 = Manager
| 7 = Admin Officer
| 8 = Academic Affairs Officer
| 9 = Examination Officer
|--------------------------------------------------------------------------
*/

const ROLE_IDS = {
    PROPRIETOR: 1,
    ADMINISTRATOR: 2,
    FINANCE: 3,
    TEACHER: 4,
    STUDENT: 5,
    MANAGER: 6,
    ADMIN_OFFICER: 7,
    ACADEMIC_AFFAIRS_OFFICER: 8,
    EXAMINATION_OFFICER: 9
};


/*
|--------------------------------------------------------------------------
| AUTHENTICATE TOKEN
|--------------------------------------------------------------------------
*/

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers.authorization;

    const token =
        authHeader && authHeader.startsWith('Bearer ')
            ? authHeader.split(' ')[1]
            : null;

    if (!token) {
        return res.status(401).json({
            message: 'Authentication required'
        });
    }

    jwt.verify(
        token,
        process.env.JWT_SECRET,
        (err, user) => {
            if (err) {
                return res.status(403).json({
                    message: 'Invalid or expired token'
                });
            }

            req.user = user;

            next();
        }
    );
};


/*
|--------------------------------------------------------------------------
| GET ROLE ID
|--------------------------------------------------------------------------
*/

function getRoleId(user) {
    return Number(user?.role_id);
}


/*
|--------------------------------------------------------------------------
| GET ROLE NAME
|--------------------------------------------------------------------------
*/

function getRoleName(user) {
    return String(user?.role_name || '')
        .trim()
        .toLowerCase();
}


/*
|--------------------------------------------------------------------------
| GET SECTOR
|--------------------------------------------------------------------------
*/

function getSector(user) {
    return String(user?.sector || '')
        .trim()
        .toLowerCase();
}


/*
|--------------------------------------------------------------------------
| REQUIRE ROLES
|--------------------------------------------------------------------------
*/

const requireRoles = (...allowedRoles) => {
    return (req, res, next) => {

        if (!req.user) {
            return res.status(401).json({
                message: 'Authentication required'
            });
        }

        const userRoleId = getRoleId(req.user);
        const userRoleName = getRoleName(req.user);

        const hasAccess = allowedRoles.some(allowedRole => {

            if (typeof allowedRole === 'number') {
                return userRoleId === allowedRole;
            }

            if (
                typeof allowedRole === 'string' &&
                !isNaN(Number(allowedRole))
            ) {
                return userRoleId === Number(allowedRole);
            }

            return (
                userRoleName ===
                String(allowedRole).trim().toLowerCase()
            );
        });

        if (!hasAccess) {
            return res.status(403).json({
                message: 'Access denied. Insufficient permissions.'
            });
        }

        next();
    };
};


/*
|--------------------------------------------------------------------------
| REQUIRE TEACHER
|--------------------------------------------------------------------------
*/

const requireTeacher = (req, res, next) => {

    if (!req.user) {
        return res.status(401).json({
            message: 'Authentication required'
        });
    }

    if (getRoleId(req.user) !== ROLE_IDS.TEACHER) {
        return res.status(403).json({
            message: 'Teacher access required'
        });
    }

    next();
};


/*
|--------------------------------------------------------------------------
| ADMINISTRATOR OR PROPRIETOR
|--------------------------------------------------------------------------
*/

function isAdminOrProprietor(user) {

    const roleId = getRoleId(user);

    return (
        roleId === ROLE_IDS.PROPRIETOR ||
        roleId === ROLE_IDS.ADMINISTRATOR
    );
}


/*
|--------------------------------------------------------------------------
| PRIMARY MANAGER
|--------------------------------------------------------------------------
*/

function isPrimaryManager(user) {

    return (
        getRoleId(user) === ROLE_IDS.MANAGER &&
        getSector(user) === 'primary'
    );
}


/*
|--------------------------------------------------------------------------
| SECONDARY MANAGER
|--------------------------------------------------------------------------
*/

function isSecondaryManager(user) {

    return (
        getRoleId(user) === ROLE_IDS.MANAGER &&
        getSector(user) === 'secondary'
    );
}


/*
|--------------------------------------------------------------------------
| FINANCE OFFICER (SECTORLESS)
|--------------------------------------------------------------------------
*/

function isFinanceOfficer(user) {

    return getRoleId(user) === ROLE_IDS.FINANCE;
}


/*
|--------------------------------------------------------------------------
| PRIMARY FINANCE OFFICER (legacy)
|--------------------------------------------------------------------------
*/

function isPrimaryFinanceOfficer(user) {

    return (
        getRoleId(user) === ROLE_IDS.FINANCE &&
        getSector(user) === 'primary'
    );
}


/*
|--------------------------------------------------------------------------
| SECONDARY FINANCE OFFICER (legacy)
|--------------------------------------------------------------------------
*/

function isSecondaryFinanceOfficer(user) {

    return (
        getRoleId(user) === ROLE_IDS.FINANCE &&
        getSector(user) === 'secondary'
    );
}


/*
|--------------------------------------------------------------------------
| ADMIN OFFICER (sectorless)
|
| Sees everything like the Proprietor, can register and edit students.
| Cannot approve anything.
|--------------------------------------------------------------------------
*/

function isAdminOfficer(user) {

    return getRoleId(user) === ROLE_IDS.ADMIN_OFFICER;
}


/*
|--------------------------------------------------------------------------
| ACADEMIC AFFAIRS OFFICER (secondary role on a Teacher)
|
| Stored on `users` as:
|     secondary_role_id = 8
|     aao_sector         = 'primary' | 'secondary'
|
| The user's primary role is Teacher (4). The JWT carries
| these extra fields.
|--------------------------------------------------------------------------
*/

function isAcademicAffairsOfficer(user) {

    return Number(user?.secondary_role_id) ===
           ROLE_IDS.ACADEMIC_AFFAIRS_OFFICER;
}


/*
|--------------------------------------------------------------------------
| EXAMINATION OFFICER (secondary role on a Teacher)
|
| Stored on `users` as:
|     is_exam_officer = true
|--------------------------------------------------------------------------
*/

function isExaminationOfficer(user) {

    return user?.is_exam_officer === true;
}


/*
|--------------------------------------------------------------------------
| CAN REGISTER STUDENTS
|
| Who may register / edit students:
|     Proprietor
|     Administrator
|     Manager
|     Admin Officer
|--------------------------------------------------------------------------
*/

function canRegisterStudents(user) {

    const roleId = getRoleId(user);

    return (
        roleId === ROLE_IDS.PROPRIETOR ||
        roleId === ROLE_IDS.ADMINISTRATOR ||
        roleId === ROLE_IDS.MANAGER ||
        roleId === ROLE_IDS.ADMIN_OFFICER
    );
}


/*
|--------------------------------------------------------------------------
| CAN APPROVE GRADES
|
| Only the Examination Officer.
|--------------------------------------------------------------------------
*/

function canApproveGrades(user) {

    return isExaminationOfficer(user);
}


/*
|--------------------------------------------------------------------------
| CAN APPROVE ANYTHING (approval endpoints)
|
| Proprietor and Administrator keep their existing approval powers.
| Admin Officer and AAO and EO cannot approve general records.
|--------------------------------------------------------------------------
*/

function canApproveRecords(user) {

    const roleId = getRoleId(user);

    return (
        roleId === ROLE_IDS.PROPRIETOR ||
        roleId === ROLE_IDS.ADMINISTRATOR
    );
}


/*
|--------------------------------------------------------------------------
| PRIMARY TEACHER
|--------------------------------------------------------------------------
*/

function isPrimaryTeacher(user) {

    return (
        getRoleId(user) === ROLE_IDS.TEACHER &&
        getSector(user) === 'primary'
    );
}


/*
|--------------------------------------------------------------------------
| SECONDARY TEACHER
|--------------------------------------------------------------------------
*/

function isSecondaryTeacher(user) {

    return (
        getRoleId(user) === ROLE_IDS.TEACHER &&
        getSector(user) === 'secondary'
    );
}


/*
|--------------------------------------------------------------------------
| ANY TEACHER
|--------------------------------------------------------------------------
*/

function isTeacher(user) {

    return getRoleId(user) === ROLE_IDS.TEACHER;
}


/*
|--------------------------------------------------------------------------
| PRIMARY USER
|--------------------------------------------------------------------------
*/

function isPrimaryUser(user) {

    return getSector(user) === 'primary';
}


/*
|--------------------------------------------------------------------------
| SECONDARY USER
|--------------------------------------------------------------------------
*/

function isSecondaryUser(user) {

    return getSector(user) === 'secondary';
}


/*
|--------------------------------------------------------------------------
| REQUIRE SECTOR
|--------------------------------------------------------------------------
*/

const requireSector = (...allowedSectors) => {

    return (req, res, next) => {

        if (!req.user) {
            return res.status(401).json({
                message: 'Authentication required'
            });
        }

        const userSector = getSector(req.user);

        const allowed = allowedSectors
            .map(sector =>
                String(sector).trim().toLowerCase()
            )
            .includes(userSector);

        if (!allowed) {
            return res.status(403).json({
                message: 'Access denied. Wrong school sector.'
            });
        }

        next();
    };
};


/*
|--------------------------------------------------------------------------
| REQUIRE ROLE + SECTOR
|--------------------------------------------------------------------------
*/

const requireRoleAndSector = (roleId, sector) => {

    return (req, res, next) => {

        if (!req.user) {
            return res.status(401).json({
                message: 'Authentication required'
            });
        }

        const userRoleId = getRoleId(req.user);
        const userSector = getSector(req.user);

        if (
            userRoleId !== Number(roleId) ||
            userSector !== String(sector).trim().toLowerCase()
        ) {
            return res.status(403).json({
                message: 'Access denied. Insufficient permissions.'
            });
        }

        next();
    };
};


/*
|--------------------------------------------------------------------------
| EXPORTS
|--------------------------------------------------------------------------
*/

module.exports = {
    authenticateToken,

    requireRoles,
    requireTeacher,
    requireSector,
    requireRoleAndSector,

    isAdminOrProprietor,

    isPrimaryManager,
    isSecondaryManager,

    isFinanceOfficer,
    isPrimaryFinanceOfficer,
    isSecondaryFinanceOfficer,

    isAdminOfficer,
    isAcademicAffairsOfficer,
    isExaminationOfficer,

    canRegisterStudents,
    canApproveGrades,
    canApproveRecords,

    isPrimaryTeacher,
    isSecondaryTeacher,

    isTeacher,

    isPrimaryUser,
    isSecondaryUser,

    getRoleId,
    getRoleName,
    getSector,

    ROLE_IDS
};