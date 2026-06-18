const mongoose = require('mongoose');

const BrandingDataSchema = new mongoose.Schema({
    date: {
        type: String,
        required: true,
        default: () => new Date().toLocaleDateString('en-GB') // DD/MM/YYYY format by default
    },
    riderName: {
        type: String,
        required: true
    },
    riderId: {
        type: String,
        required: true
    },
    vehicleReg: {
        type: String,
        required: true
    },
    backPhoto: {
        type: String,
        required: true
    },
    rearPhoto: {
        type: String,
        required: true
    },
    oppositePhoto: {
        type: String,
        required: true
    },
    frontPhoto: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    bufferCommands: false
});

module.exports = mongoose.model('BrandingData', BrandingDataSchema);
