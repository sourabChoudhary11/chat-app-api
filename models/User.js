import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
    username: {
        type: String,
        unique: true,
        required: true,
        minLength: 5,
    },
    password: {
        type: String,
        required: true,
        minLength: 8,
        select: false,
    },
}, {
    timestamps: true
})

const UserModel = mongoose.model('users', UserSchema)

export {UserModel};