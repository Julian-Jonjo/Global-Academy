const jwt = require('jsonwebtoken');

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Authentication required' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

const requireTeacher = (req, res, next) => {
    const userRole = req.user.role_name || '';
    if (!userRole.includes('Teacher')) {
        return res.status(403).json({ message: 'Teacher access required' });
    }
    next();
};

const requireRoles = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        const userRole = req.user.role_name || '';
        
        const hasAccess = allowedRoles.some(role => 
            userRole.toLowerCase() === role.toLowerCase()
        );

        if (!hasAccess) {
            return res.status(403).json({ 
                message: 'Access denied. Insufficient permissions.' 
            });
        }

        next();
    };
};

// Helper: Check if user is Admin or Proprietor
function isAdminOrProprietor(userRole) {
    const role = (userRole || '').toLowerCase();
    return role.includes('admin') || role.includes('proprietor');
}

// Helper: Check if user is Primary Manager (includes Nursery)
function isPrimaryManager(userRole) {
    const role = (userRole || '').toLowerCase();
    return (role.includes('manager-primary') || role.includes('primary manager')) && 
           !isAdminOrProprietor(role);
}

// Helper: Check if user is Secondary Manager (includes JSS and SSS)
function isSecondaryManager(userRole) {
    const role = (userRole || '').toLowerCase();
    return (role.includes('manager-secondary') || role.includes('secondary manager')) && 
           !isAdminOrProprietor(role);
}

// Helper: Check if user is Primary Finance Officer
function isPrimaryFinanceOfficer(userRole) {
    const role = (userRole || '').toLowerCase();
    return role.includes('primary finance') && !isAdminOrProprietor(role);
}

// Helper: Check if user is Secondary Finance Officer
function isSecondaryFinanceOfficer(userRole) {
    const role = (userRole || '').toLowerCase();
    return role.includes('secondary finance') && !isAdminOrProprietor(role);
}
// Helper: Check if user is Primary Teacher
function isPrimaryTeacher(userRole) {
    const role = (userRole || '').toLowerCase();
    return role.includes('teacher - primary');
}

// Helper: Check if user is Secondary Teacher
function isSecondaryTeacher(userRole) {
    const role = (userRole || '').toLowerCase();
    return role.includes('teacher - secondary');
}

// Helper: Check if user is any Teacher
function isTeacher(userRole) {
    const role = (userRole || '').toLowerCase();
    return role.includes('teacher');
}

module.exports = { 
    authenticateToken, 
    requireTeacher, 
    requireRoles,
    isAdminOrProprietor,
    isPrimaryManager,
    isSecondaryManager,
    isPrimaryFinanceOfficer,
    isSecondaryFinanceOfficer
};