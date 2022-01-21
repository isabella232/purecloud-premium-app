import config from '../../config/config.js';

const platformClient = require('platformClient');
const oAuthApi = new platformClient.OAuthApi();
const authorizationApi = new platformClient.AuthorizationApi();
const usersApi = new platformClient.UsersApi();

/**
* Get existing authetication clients based on the prefix
* @returns {Promise.<Array>} Array of Genesys Cloud OAuth Clients
*/
async function getExisting() {
    let data = await oAuthApi.getOauthClients();
    return data.entities.filter((entity) => entity.name.startsWith(config.prefix));
}

/**
 * Delete all existing PremiumApp instances
 * @param {Function} logFunc logs any messages
 * @returns {Promise}
 */
async function remove(logFunc) {
    logFunc('Uninstalling OAuth Clients...');

    let instances = await getExisting();
    let del_clients = [];

    if (instances.length > 0) {
        instances.forEach(entity => {
            del_clients.push(oAuthApi.deleteOauthClient(entity.id));
        });
    }

    return Promise.all(del_clients);
}

/**
 * Add Genesys Cloud instances based on installation data
 * @param {Function} logFunc logger for messages
 * @param {Object} data the installation data for this type
 * @returns {Promise.<Object>} were key is the unprefixed name and the values
 *                          is the Genesys Cloud object details of that type.
 */
async function create(logFunc, data) {
    let authData = {};

    // Assign employee role to the oauth client because required
    // to have a role id on creation
    let rolesResult = await authorizationApi.getAuthorizationRoles({
                                name: 'employee'
                            });
    let employeeRole = rolesResult.entities[0];
    let authPromises = [];

    data.forEach((oauth) => {
        let oauthClient = {
            name: config.prefix + oauth.name,
            description: oauth.description,
            authorizedGrantType: oauth.authorizedGrantType,
            roleIds: [employeeRole.id]
        };

        authPromises.push((async () => {
            try{
                let result = await oAuthApi.postOauthClients(oauthClient);
                authData[oauth.name] = result;

                logFunc('Created ' + result.name + ' auth client');
            } catch(e) {
                console.log(e);
            }
        })());
    });

    await Promise.all(authPromises);
    return authData;
}

/**
 * Further configuration needed by this object
 * Called after eveything has already been installed
 * @param {Function} logFunc logger for messages
 * @param {Object} installedData contains everything that was installed by the wizard
 * @param {String} userId User id if needed
 */
async function configure(logFunc, installedData, userId) {
    let promiseArr = [];
    let oauthData = installedData['oauth-client'];

    Object.keys(oauthData).forEach((oauthKey) => {
        let promise = new Promise((resolve, reject) => {
            let oauth = oauthData[oauthKey];
            let oauthInstall = config.provisioningInfo['oauth-client']
                .find((info) => info.name == oauthKey);

            let timer = setInterval(() => {
                usersApi.getUsersMe({
                    expand: ['authorization']
                })
                    .then((result) => {
                        console.log(result);
                        let userRoleIds = result.authorization.roles.map(u => u.id);
                        let userAssigned = true;

                        // Check if all roles for these client is already assigned
                        // to the user
                        oauthInstall.roles.forEach((r) => {
                            if (!userRoleIds.includes(installedData.role[r].id)) {
                                userAssigned = false;
                            }
                        });

                        if (userAssigned) {
                            clearInterval(timer);

                            oAuthApi.putOauthClient(
                                oauthData[oauthKey].id,
                                {
                                    name: oauth.name,
                                    authorizedGrantType: oauth.authorizedGrantType,
                                    roleIds: oauthInstall.roles.map(
                                        (roleName) => installedData.role[roleName].id)
                                        .filter(g => g != undefined)
                                }
                            )
                                .then(() => {
                                    resolve();
                                })
                                .catch((e) => reject(e));
                        }
                    })
                    .catch(e => {
                        clearInterval(timer);

                        console.error(e);
                    });
            }, 3000);
        });

        promiseArr.push(promise);
    });

    return Promise.all(promiseArr);
}


export default {
    provisioningInfoKey: 'oauth-client',

    getExisting: getExisting,
    remove: remove,
    create: create,
    configure: configure
}