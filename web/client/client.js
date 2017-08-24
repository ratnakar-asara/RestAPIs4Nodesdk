'use strict';

function assemble_url (function_name, req) {
    let url = '/'+function_name+'?';
    const req_keys = Object.keys(req);
    for (var i = 0; i < req_keys.length; i += 1) {
        var key = req_keys[i];
        var value = req[key];
        if (value === undefined) {
            value = '';
        }
        url += key+'='+value;
        if (i+1 < req_keys.length) {
            url += '&';
        }
    }
    return url;
}

angular
.module('app', [])
.controller('controller', ['$scope', '$http', '$timeout', '$window', function($scope, $http, $timeout, $window) {
    $window.scope = $scope;

    $scope.log_content = '';
    $scope.append_to_log = text => {
        $scope.log_content += '-- ';
        $scope.log_content += text;
        $scope.log_content += '\n';
        const log_textarea = document.getElementById('log_textarea');
        // This causes the log to scroll to the bottom (almost).
        log_textarea.scrollTop = log_textarea.scrollHeight;
        console.log(text);
    };

    $scope.post = function (function_name, req) {
        const url = assemble_url(function_name, req);
        const transaction_description = function_name + ' ' + JSON.stringify(req);
        $scope.append_to_log('POST ' + transaction_description);
        return $http.post(url)
        .then(response => {
            $scope.append_to_log('POST ' + transaction_description + ' succeeded: ' + JSON.stringify(response.data));
            return {
                'transaction_description'   :transaction_description,
                'url'                       :url,
                'response'                  :response
            };
        }, response => {
            $scope.append_to_log('POST ' + transaction_description + ' failed: ' + JSON.stringify(response.data));
            throw {
                'transaction_description'   :transaction_description,
                'url'                       :url,
                'response'                  :response
            };
        });
    };
    $scope.get = function (function_name, req) {
        const url = assemble_url(function_name, req);
        const transaction_description = function_name + ' ' + JSON.stringify(req);
        $scope.append_to_log('GET ' + transaction_description);
        return $http.get(url)
        .then(response => {
            $scope.append_to_log('GET ' + transaction_description + ' succeeded: ' + JSON.stringify(response.data));
            return {
                'transaction_description'   :transaction_description,
                'url'                       :url,
                'response'                  :response
            };
        }, response => {
            $scope.append_to_log('GET ' + transaction_description + ' failed: ' + JSON.stringify(response.data));
            throw {
                'transaction_description'   :transaction_description,
                'url'                       :url,
                'response'                  :response
            };
        });
    };

    $scope.account_context_d        = {};

    $scope.make_account_context     = function (account_name) {
        $scope.account_context_d[account_name] = {
            parent                          : $scope,
            account_name                    : account_name,
            balance                         : null,
            create_account__account_name    : null,
            create_account__initial_balance : null,
            delete_account__account_name    : null,
            transfer__from_account_name     : null,
            transfer__to_account_name       : null,
            transfer__amount                : null,
            query_balance__account_name     : null
        };
    };
    $scope.bootstrap_account = function (account_name) {
        $scope.append_to_log('bootstrap_account("'+account_name+'");');

        console.assert(!(account_name in Object.keys($scope.account_context_d)), 'Account "'+account_name+'" already exists');
        $scope.make_account_context(account_name);

        const account_context   = $scope.account_context_d[account_name];
        account_context.balance = 'N/A';

        const account_panel = angular.element(document.getElementById('account_panel'));
        account_panel.attr('context', 'account_context_d["'+account_name+'"]');
        // This nonsense updates the angularjs state based on the changes to the 'context' attribute.
        account_panel.injector().invoke(function($compile){
            $compile(account_panel)(account_panel.scope());
        });
    };
    $scope.switch_to_account = function (account_name) {
        $scope.append_to_log('switch_account_panel_to("'+account_name+'");');

        if (!(account_name in Object.keys($scope.account_context_d))) {
            $scope.make_account_context(account_name);
        }

        const account_context   = $scope.account_context_d[account_name];
//         // Clear old state until the new state is retrieved.
//         account_context.balance = '';

        $scope.query_balance(account_name)
        .then(response => {
            $scope.append_to_log('response = "' + response + '"');

            account_context.balance = response.response.data;

            const account_panel = angular.element(document.getElementById('account_panel'));
            account_panel.attr('context', 'account_context_d["'+account_name+'"]');
            // This nonsense updates the angularjs state based on the changes to the 'context' attribute.
            account_panel.injector().invoke(function($compile){
                $compile(account_panel)(account_panel.scope());
            });
        })
        .catch(err => {
            $scope.append_to_log('error: no account named "' + account_name + '" found.');
        });
    };

    $scope.create_account = function (account_name, initial_balance) {
        return $scope.post('create_account', {account_name:account_name, initial_balance:initial_balance});
    };
    $scope.delete_account = function (account_name) {
        return $scope.post('delete_account', {account_name:account_name});
    };
    $scope.transfer = function (from_account_name, to_account_name, amount) {
        return $scope.post('transfer', {from_account_name:from_account_name, to_account_name:to_account_name, amount:amount});
    };
    $scope.query_balance = function (account_name) {
        return $scope.get('query_balance', {account_name:account_name});
    };

    $timeout(function(){
        $scope.append_to_log('testing');
//         Promise.resolve()
//         .then(() => {
//             return $scope.post('create_account', {'account_name':'alice', 'initial_balance':'123'});
//         })
//         .then(() => {
//             return $scope.post('create_account', {'account_name':'bob', 'initial_balance':'456'});
//         })
//         .then(() => {
//             return Promise.all([
//                 $scope.get('query_balance', {'account_name':'alice'}),
//                 $scope.get('query_balance', {'account_name':'bob'})
//             ]);
//         })
//         .then(results => {
//             // TODO: for some dumb reason this is not causing the log to change
//             $scope.append_to_log('results: ' + JSON.stringify(results));
//             console.assert(results.length == 2);
//             console.assert(results[0].response.data == '123', results[0]);
//             console.assert(results[1].response.data == '456', results[1]);
//             $scope.append_to_log('all calls behaved as expected.');
//         })
//         .catch(err => {
//             $scope.append_to_log('UNHANDLED ERROR: ' + JSON.stringify(err));
//             $scope.append_to_log('stack:');
//             $scope.append_to_log(err.stack);
//         });

        $scope.bootstrap_account('Admin');
    });
}])
.directive('accountPanel', () => {
    return {
        scope: {
            context: '=context'
        },
        templateUrl: 'partials/account_panel.html'
    };
});
