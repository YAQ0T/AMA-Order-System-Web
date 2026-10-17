const tls = require('tls');

/**
 * Middleware to validate client certificates for mTLS authentication
 * This ensures only devices with valid employee certificates can access the system
 */
const validateClientCertificate = (req, res, next) => {
    // Get client certificate from the TLS connection
    const cert = req.socket.getPeerCertificate();

    // Check if certificate exists
    if (!cert || Object.keys(cert).length === 0) {
        console.error('Certificate validation failed: No client certificate provided');
        return res.status(401).json({
            error: 'Client certificate required',
            message: 'This system requires a valid employee certificate. Please install the employee certificate on your device.'
        });
    }

    // Check if certificate is authorized (signed by our CA)
    if (!req.client.authorized) {
        console.error('Certificate validation failed: Certificate not authorized');
        console.error('Authorization error:', req.socket.authorizationError);
        return res.status(403).json({
            error: 'Invalid client certificate',
            message: 'Your certificate is not authorized. Please contact IT support.',
            details: req.socket.authorizationError
        });
    }

    // Extract certificate information
    const certInfo = {
        subject: cert.subject,
        issuer: cert.issuer,
        validFrom: cert.valid_from,
        validTo: cert.valid_to,
        fingerprint: cert.fingerprint,
        serialNumber: cert.serialNumber
    };

    // Check if certificate is expired
    const now = new Date();
    const validFrom = new Date(cert.valid_from);
    const validTo = new Date(cert.valid_to);

    if (now < validFrom || now > validTo) {
        console.error('Certificate validation failed: Certificate expired or not yet valid');
        return res.status(403).json({
            error: 'Certificate expired',
            message: 'Your employee certificate has expired. Please contact IT support for a new certificate.',
            validFrom: cert.valid_from,
            validTo: cert.valid_to
        });
    }

    // Attach certificate info to request for logging/auditing
    req.clientCertificate = certInfo;

    // Log successful authentication
    console.log(`Client certificate validated: ${cert.subject.CN} (Serial: ${cert.serialNumber})`);

    next();
};

/**
 * Optional: Extract employee information from certificate
 */
const getEmployeeFromCertificate = (req) => {
    if (!req.clientCertificate) {
        return null;
    }

    return {
        commonName: req.clientCertificate.subject.CN,
        organization: req.clientCertificate.subject.O,
        organizationalUnit: req.clientCertificate.subject.OU,
        serialNumber: req.clientCertificate.serialNumber,
        fingerprint: req.clientCertificate.fingerprint
    };
};

module.exports = {
    validateClientCertificate,
    getEmployeeFromCertificate
};
