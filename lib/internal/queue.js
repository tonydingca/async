import arrayEach from 'lodash/_arrayEach';
import isArray from 'lodash/isArray';
import noop from 'lodash/noop';

import onlyOnce from './onlyOnce';
import setImmediate from './setImmediate';
import DLL from './DoublyLinkedList';

export default function queue(worker, concurrency, payload) {
    if (concurrency == null) {
        concurrency = 1;
    }
    else if(concurrency === 0) {
        throw new Error('Concurrency must not be zero');
    }

    function _insert(data, pos, callback) {
        if (callback != null && typeof callback !== 'function') {
            throw new Error('task callback must be a function');
        }
        q.started = true;
        if (!isArray(data)) {
            data = [data];
        }
        if(data.length === 0 && q.idle()) {
            // call drain immediately if there are no tasks
            return setImmediate(function() {
                q.drain();
            });
        }
        arrayEach(data, function(task) {
            var item = {
                data: task,
                callback: callback || noop
            };

            if (pos) {
                q._tasks.unshift(item);
            } else {
                q._tasks.push(item);
            }

        });
        setImmediate(q.process);
    }

    function _next(tasks) {
        return function(){
            workers -= 1;

            var removed = false;
            var args = arguments;
            arrayEach(tasks, function (task) {
                arrayEach(workersList, function (worker, index) {
                    if (worker === task && !removed) {
                        workersList.splice(index, 1);
                        removed = true;
                    }
                });

                task.callback.apply(task, args);

                if (args[0] != null) {
                    q.error(args[0], task.data);
                }
            });

            if (workers <= (q.concurrency - q.buffer) ) {
                q.unsaturated();
            }

            if (q._tasks.length + workers === 0) {
                q.drain();
            }
            q.process();
        };
    }

    var workers = 0;
    var workersList = [];
    var q = {
        _tasks: new DLL(),
        concurrency: concurrency,
        payload: payload,
        saturated: noop,
        unsaturated:noop,
        buffer: concurrency / 4,
        empty: noop,
        drain: noop,
        error: noop,
        started: false,
        paused: false,
        push: function (data, callback) {
            _insert(data, false, callback);
        },
        kill: function () {
            q.drain = noop;
            q._tasks.empty();
        },
        unshift: function (data, callback) {
            _insert(data, true, callback);
        },
        process: function () {
            while(!q.paused && workers < q.concurrency && q._tasks.length){
                var tasks = [], data = [];
                var l = q._tasks.length;
                if (q.payload) l = Math.min(l, q.payload);
                for (var i = 0; i < l; i++) {
                    var node = q._tasks.shift();
                    tasks.push(node);
                    data.push(node.data);
                }

                if (q._tasks.length === 0) {
                    q.empty();
                }
                workers += 1;
                workersList.push(tasks[0]);

                if (workers === q.concurrency) {
                    q.saturated();
                }

                var cb = onlyOnce(_next(tasks));
                worker(data, cb);
            }
        },
        length: function () {
            return q._tasks.length;
        },
        running: function () {
            return workers;
        },
        workersList: function () {
            return workersList;
        },
        idle: function() {
            return q._tasks.length + workers === 0;
        },
        pause: function () {
            q.paused = true;
        },
        resume: function () {
            if (q.paused === false) { return; }
            q.paused = false;
            var resumeCount = Math.min(q.concurrency, q._tasks.length);
            // Need to call q.process once per concurrent
            // worker to preserve full concurrency after pause
            for (var w = 1; w <= resumeCount; w++) {
                setImmediate(q.process);
            }
        }
    };
    return q;
}
