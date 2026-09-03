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
|--------------------------------------------------------------------------
*/

const ROLE_IDS = {
    PROPRIETOR: 1,
    ADMINISTRATOR: 2,
    FINANCE: 3,
    TEACHER: 4,
    STUDENT: 5,
    MANAGER: 6
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
|
| Preferred usage:
|
|     requireRoles(1, 2)
|
|     requireRoles(6)
|
|     requireRoles(3, 6)
|
| Numeric role IDs are authoritative.
|
| For backward compatibility, this also temporarily accepts
| role names such as:
|
|     requireRoles('Administrator', 'Proprietor')
|
| This allows existing routes to continue working while we
| convert them to role IDs.
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

            /*
             * Numeric role ID
             */
            if (typeof allowedRole === 'number') {
                return userRoleId === allowedRole;
            }

            /*
             * Numeric string
             */
            if (
                typeof allowedRole === 'string' &&
                !isNaN(Number(allowedRole))
            ) {
                return userRoleId === Number(allowedRole);
            }

            /*
             * Temporary backwards compatibility
             * for existing routes using role names.
             */
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
| PRIMARY FINANCE OFFICER
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
| SECONDARY FINANCE OFFICER
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
|
| Example:
|
|     router.get(
|         '/primary-students',
|         authenticateToken,
|         requireSector('primary'),
|         ...
|     );
|
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
|
| This is useful for routes that should only be accessible to
| a particular role within a particular sector.
|
| Example:
|
|     requireRoleAndSector(6, 'primary')
|
| means:
|
|     Manager + Primary
|
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

    isPrimaryFinanceOfficer,
    isSecondaryFinanceOfficer,

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