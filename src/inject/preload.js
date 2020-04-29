'use strict';

const { ipcRenderer, webFrame } = require('electron');
const MenuHandler = require('../handlers/menu');
const ShareMenu = require('./share_menu');
const MentionMenu = require('./mention_menu');
const BadgeCount = require('./badge_count');
const Common = require('../common');
// const EmojiParser = require('./emoji_parser');
// const emojione = require('emojione');

const AppConfig = require('../configuration');

class Injector {
    init() {
        if (Common.DEBUG_MODE) {
            Injector.lock(window, 'console', window.console);
        }

        this.constants = null;
        this.contacts = new Map();

        // 缓存， 针对重复的，保存最后一次出现的
        //缓存nickname-remark ==> userName        
        this.cacheNames = new Map();
        //缓存nickname ==> userName
        this.cacheNicks = new Map();
        // remarkName不是必需的，缓存的与contacts不是一一对应，
        this.cacheRemarks = new Map();

        this.chats = null;

        this.utilFactory = null;


        this.Skey = null;
        this.UserInfo = null;

        this.initInjectBundle();
        this.initAngularInjection();
        this.lastUser = null;
        this.initIPC();
        //webFrame.setZoomLevelLimits(1, 1);

        new MenuHandler().create();
    }

    initAngularInjection() {
        const self = this;
        const angular = window.angular = {};
        let angularBootstrapReal;
        Object.defineProperty(angular, 'bootstrap', {
            get: () => angularBootstrapReal ? function(element, moduleNames) {
                const moduleName = 'webwxApp';
                if (moduleNames.indexOf(moduleName) < 0) return;
                self.constants = null;
                self.chats = null;
                this.Skey = null;
                this.UserInfo = null;
                this.utilFactory = null;

                angular.injector(['ng', 'Services']).invoke(['confFactory', (confFactory) => (self.constants = confFactory)]);

                // chatFactor
                angular.injector(['ng', 'Services']).invoke(['chatFactory', (chatFactory) => (self.chats = chatFactory)]);

                // account
                //angular.injector(['ng', 'Services']).invoke(['accountFactory', (accountFactory) => (self.account = accountFactory)]);

                // util
                angular.injector(['ng', 'Services']).invoke(['utilFactory', (utilFactory) => (self.utilFactory = utilFactory)]);

                angular.module(moduleName).config(['$httpProvider', ($httpProvider) => {
                    $httpProvider.defaults.transformResponse.push((value) => {
                        return self.transformResponse(value, self.constants);
                    });
                    $httpProvider.defaults.transformRequest.push((value) => {
                        return self.transformRequest(value, self.constants);
                    });
                }, ]).run(['$rootScope', ($rootScope) => {
                    ipcRenderer.send('wx-rendered', MMCgi.isLogin);
                    $rootScope.$on('newLoginPage', () => {
                        ipcRenderer.send('user-logged', '');
                    });
                    $rootScope.shareMenu = ShareMenu.inject;
                    $rootScope.mentionMenu = MentionMenu.inject;
                }]);
                // 获取发送消息
                // setTimeout(() => {
                //     if (MMCgi.isLogin && self.chats) {
                //         self.sendTextMessage(self, 'test123__1', '@4ecb84cd544c84d9f0f2fc0ea93f92dc3a00899a0ce4e867d4bd0a1b1a4dbdc7');

                //     }
                // }, 1000 * 10);


                return angularBootstrapReal.apply(angular, arguments);
            } : angularBootstrapReal,
            set: (real) => (angularBootstrapReal = real),
        });
    }


    sendTextMessage(self, msg, toAddr) {
        // 打印账号信息
        console.log('name:' + self.UserInfo.UserName + " nickname:" + self.UserInfo.NickName + " Skey:" + self.Skey);


        var _msg = self.chats.createMessage({
            MsgType: self.constants.MSGTYPE_TEXT,
            Content: msg,
            ToUserName: toAddr,
            FromUserName: self.UserInfo.UserName
        });
        self.chats.appendMessage(_msg);
        console.log("notify-> " + _msg);
        self.chats.sendMessage(_msg);

    }

    dipatchMsg(msg, toUserName) {
        let self = this;
        var transpondMsg = angular.copy(msg);
        transpondMsg.ToUserName = toUserName;
        transpondMsg.FromUserName = self.UserInfo.UserName;
        transpondMsg.isTranspond = true;
        /*
         * 因为获取 local image 需要 msgid， 但是转发前本地是没有正确的 msgid 的，只能用转发前那个消息的
         * */
        transpondMsg.MsgIdBeforeTranspond = msg.MsgIdBeforeTranspond || msg.MsgId;

        transpondMsg._h = undefined;
        transpondMsg._offsetTop = undefined;
        transpondMsg.MMSourceMsgId = msg.MsgId;


        /*    transpondMsg.Content= msg.OriContent || utilFactory.htmlDecode(transpondMsg.MMActualContent);*/
        transpondMsg.Scene = 2;
        transpondMsg = self.chats.createMessage(transpondMsg);

        /*
         * 文件发送根据这个决定是否 reset 发送状态
         * */
        transpondMsg.sendByLocal = false;
        /*
         * 地理位置消息有  OriContent
         * 因为 Content 是阉割过后的
         * */
        transpondMsg.Content = this.utilFactory.htmlDecode(transpondMsg.Content.replace(/^@\w+:<br\/>/, ''));
        transpondMsg.MMActualSender = self.UserInfo.UserName; //accountFactory.getUserName();
        if (transpondMsg.MMSendContent) {
            transpondMsg.MMSendContent = transpondMsg.MMSendContent.replace(/^@\w+:\s/, '');
        }

        if (transpondMsg.MMDigest) {
            transpondMsg.MMDigest = transpondMsg.MMDigest.replace(/^@\w+:/, '');
        }

        if (transpondMsg.MMActualContent) {
            transpondMsg.MMActualContent = this.utilFactory.clearHtmlStr(transpondMsg.MMActualContent.replace(/^@\w+:<br\/>/, ''));
        }

        self.chats.appendMessage(transpondMsg);
        self.chats.sendMessage(transpondMsg);

    }


    initInjectBundle() {
        const initModules = () => {
            if (!window.$) {
                return setTimeout(initModules, 3000);
            }

            MentionMenu.init();
            BadgeCount.init();
        };

        window.onload = () => {
            initModules();
            window.addEventListener('online', () => {
                ipcRenderer.send('reload', true);
            });
        };
    }

    transformRequest(value, constants) {
        if (!value) return value;

        console.log(value);
        return value;
    }

    getAccountInfo(value) {
        if (value && value.hasOwnProperty("User") && value.hasOwnProperty("SKey")) {
            this.Skey = value.Skey;
            this.UserInfo = value.User;
        }
    }

    // reflush 为true 表示要重载，如果未传参数则不重载
    getAllContacts(reflush) {
        if (this.contacts.size > 0 && !reflush)
            return this.contacts;
        // reflush
        this.contacts.clear();
        this.cacheNames.clear();
        this.cacheRemarks.clear();
        this.cacheNicks.clear();
        // 获取所有联系人
        var _contacts = angular.element('#navContact').scope().allContacts;
        _contacts.forEach((one) => {
            if (one.hasOwnProperty('UserName')) {
                this.contacts.set(one.UserName, one);
                // caches
                this.cacheNames.set(one.NickName + '__' + one.RemarkName, one.UserName);
                this.cacheNicks.set(one.NickName, one.UserName);
                this.cacheNicks.set(one.RemarkName, one.UserName);

            }
        });
        return this.contacts;
    }

    getContactByUserName(userName) {
        return this.contacts.get(userName);
    }

    isRoom(userName) {
        return userName.length > 2 && userName.substring(0, 2) == '@@';
    }

    // 通过nickName | remarkName获取联系人
    getContact(nickName, remarkName) {
        let hasNickName = nickName && nickName.length > 0;
        let hasRemarkName = remarkName && remarkName.length > 0;

        if (!hasNickName && !hasRemarkName)
            return null;
        var search_key = null;

        if (!hasNickName && hasRemarkName) {
            // 通过remarkName 获取
            search_key = this.cacheRemarks.get(remarkName);
        } else if (!hasRemarkName && hasNickName) {
            // 通过昵称获取    
            search_key = this.cacheNicks.get(nickName);
        } else {
            // 通过昵称&remarkName获取
            search_key = this.cacheNames.get(nickName + '__' + remarkName);
        }
        if (search_key)
            return this.contacts.get(search_key);

        return null;
    }


    transformResponse(value, constants) {
        if (!value) return value;

        switch (typeof value) {
            case 'object':
                this.getAccountInfo(value);
                /* Inject emoji stickers and prevent recalling. */
                return this.checkMsgContent(value, constants);
            case 'string':
                /* Inject share sites to menu. */
                return this.checkTemplateContent(value);
        }
        return value;
    }

    static lock(object, key, value) {
        return Object.defineProperty(object, key, {
            get: () => value,
            set: () => {},
        });
    }

    // 处理消息，并将需要的消息放入消息队列
    checkNeedDispatchMsg(msg, constants) {
        // 去除系统消息
        if (msg.MsgType == constants.MSGTYPE_SYS)
            return;

        //首先去除群消息
        if (this.isRoom(msg.FromUserName)) {
            return;
        }

        // test --> 当前只处理测试账号
        // 如果没有当前账号，则我们更新下账号信息
        if (!this.contacts.has(msg.FromUserName)) {
            this.getAllContacts(true);
        }

        let userinfo = this.getContactByUserName(msg.FromUserName);
        // 获取需要转发的人信息
        let toUserInfo = this.getContact('cc', null);

        if (userinfo && userinfo.RemarkName == '耿健航' && toUserInfo) {
            // 当前人的消息，则转发
            this.dipatchMsg(msg, toUserInfo.UserName);
        }

    }

    checkMsgContent(value, constants) {
        console.log(value);
        if (!(value.AddMsgList instanceof Array)) return value;

        // check emjicontent
        value.AddMsgList.forEach((msg) => {
            // push to msg queue if need dispatch
            this.checkNeedDispatchMsg(msg, constants);
            switch (msg.MsgType) {
                // case constants.MSGTYPE_TEXT:
                //   msg.Content = EmojiParser.emojiToImage(msg.Content);
                //   break;
                case constants.MSGTYPE_EMOTICON:
                    Injector.lock(msg, 'MMDigest', '[Emoticon]');
                    Injector.lock(msg, 'MsgType', constants.MSGTYPE_EMOTICON);
                    if (msg.ImgHeight >= Common.EMOJI_MAXIUM_SIZE) {
                        Injector.lock(msg, 'MMImgStyle', { height: `${Common.EMOJI_MAXIUM_SIZE}px`, width: 'initial' });
                    } else if (msg.ImgWidth >= Common.EMOJI_MAXIUM_SIZE) {
                        Injector.lock(msg, 'MMImgStyle', { width: `${Common.EMOJI_MAXIUM_SIZE}px`, height: 'initial' });
                    }
                    break;
                case constants.MSGTYPE_RECALLED:
                    if (AppConfig.readSettings('prevent-recall') === 'on') {
                        Injector.lock(msg, 'MsgType', constants.MSGTYPE_SYS);
                        Injector.lock(msg, 'MMActualContent', Common.MESSAGE_PREVENT_RECALL);
                        Injector.lock(msg, 'MMDigest', Common.MESSAGE_PREVENT_RECALL);
                    }
                    break;
            }
        });
        return value;
    }

    checkTemplateContent(value) {
        const optionMenuReg = /optionMenu\(\);/;
        const messageBoxKeydownReg = /editAreaKeydown\(\$event\)/;
        if (optionMenuReg.test(value)) {
            value = value.replace(optionMenuReg, 'optionMenu();shareMenu();');
        } else if (messageBoxKeydownReg.test(value)) {
            value = value.replace(messageBoxKeydownReg, 'editAreaKeydown($event);mentionMenu($event);');
        }
        return value;
    }

    initIPC() {
        // clear currentUser to receive reddot of new messages from the current chat user
        ipcRenderer.on('hide-wechat-window', () => {
            this.lastUser = angular.element('#chatArea').scope().currentUser;
            angular.element('.chat_list').scope().itemClick("");
        });
        // recover to the last chat user
        ipcRenderer.on('show-wechat-window', () => {
            if (this.lastUser != null) {
                angular.element('.chat_list').scope().itemClick(this.lastUser);
            }
        });
    }
}

new Injector().init();