(function() {
    'use strict';

    var log = require(process.cwd() + '/build/server/logging.js').getLogger('manglers/ErrorHandler.js');

    var renderServiceModule= require(process.cwd() + '/build/server/renderService.js');

    var dateUtils = require(process.cwd()+'/build/server/DateUtils.js').DateUtils;
    var nodemailer = require(process.cwd() + '/node_modules/nodemailer');
    var transport = nodemailer.createTransport('Sendmail');

    function ErrorHandler(ctx) {
        this.ctx=ctx;

        this.handleProcessingError=function(event){
            var template ="Pocas spracovanie udalosti/eventu {{eventType}} \n nastala chyba {{error}}. \n\n Zdrojovy Event: {{eventJson}}.";
            var subject = "[WARN]: Chyba spracovania eventu "+ new Date();
            var causeEvent = event.causeEvent;
            var eventJson =JSON.stringify(causeEvent);

            var renderService = new renderServiceModule.RenderService();
            var resolvedBody=renderService.renderInstant(template,{locals:{'eventType':causeEvent.eventType,'error':event.error,'eventJson':eventJson}});

            var mailOptions = {
                from : 'websupport@unionsoft.sk',
                to : this.ctx.config.mails.eventProcessingError,
                subject :  subject,
                html : resolvedBody
            };
            log.verbose('sending mail',mailOptions);
            transport.sendMail(mailOptions);
        };

    }

    ErrorHandler.prototype.handle = function(event) {
        log.info('handle called',event,ErrorHandler.prototype.ctx);

        if ("event-processing-error" === event.eventType){
            this.handleProcessingError(event);
        } else {

        }


    };

    ErrorHandler.prototype.getType=function(){
        return ['event-processing-error'];
    };
    module.exports = function( ctx) {
        return new ErrorHandler(ctx);
    };
}());
