const jwt = require('jsonwebtoken');

function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            message: 'Authentication required'
        });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        req.user = decoded;

        next();
    } catch (error) {
        return res.status(403).json({
            message: 'Invalid or expired authentication token'
        });
    }
}

function requireRoles(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                message: 'Authentication required'
            });
        }

        if (!allowedRoles.includes(req.user.role_name)) {
            return res.status(403).json({
                message: 'You do not have permission to access this resource'
            });
        }

        next();
    };
}

function requireTeacher(req, res, next) {
    if (!req.user) {
        return res.status(401).json({
            message: 'Authentication required'
        });
    }

    if (req.user.role_name !== 'Teacher') {
        return res.status(403).json({
            message: 'Teacher access required'
        });
    }

    next();
}

module.exports = {
    authenticateToken,
    requireRoles,
    requireTeacher
};