const { config } = require("../config");
const {redis} = require("../config/redis");
const prisma = require('../config/prisma');



const getProfile = async(userId) =>{
     // Cache-aside: serve from Redis, fall back to DB and backfill the cache.
     const storedUser = await redis.get(`user:${userId}`);
     if(storedUser){
          return JSON.parse(storedUser);
     }

     const userProfile = await prisma.user.findUnique({
          where: {
               id: userId
          }
     })

     const {password: _password, ...safeUser} = userProfile;
     await redis.set(`user:${userId}`, JSON.stringify(safeUser), 'EX', config.REDIS_USER_TTL);
     return safeUser;
}

module.exports = {getProfile}