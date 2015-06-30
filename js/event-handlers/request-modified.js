(function() {
	'use strict';

	var log = require(process.cwd() + '/build/server/logging.js').getLogger('handlers/RequestChangedHandler.js');
	var objectTools = require(process.cwd() + '/build/server/ObjectTools.js');
	var universalDaoModule = require(process.cwd() + '/build/server/UniversalDao.js');
	var dateUtils = require(process.cwd()+'/build/server/DateUtils.js').DateUtils;
	var QueryFilter = require(process.cwd()+'/build/server/QueryFilter.js');

	var nodemailer = module.parent.require('nodemailer');
	var renderModule =  module.parent.require('./renderService.js');
	var transport = nodemailer.createTransport('Sendmail');

	var GEN_REQ_COLLECTION = 'generalRequests';
	var REG_REQ_COLLECTION = 'registrationRequests';
	var DATA_REQ_COLLECTION = 'dataChangeRequests';
	var TRANS_REQ_COLLECTION = 'transferRequests';


	/**
	*	@module server
	*	@submodule event.handler
	*	@class RequestChangedHandler
	*/
	function RequestChangedHandler(ctx) {
		this.ctx=ctx;
		var self=this;
		var renderService = new renderModule.RenderService();

		var userDao = new universalDaoModule.UniversalDao(
			this.ctx.mongoDriver,
			{collectionName: 'people'}
		);

		/**
			Method handles <b>event-request-created<b> event.
			<br>Method does:
			<li>updates/initializes requests attributes setupDate,applicant,status,assignedTo</li>
			<li>sends notification mail to cfg defined issue solver ('requestSolverAddress') </li>
			<br>
			Limitations: requestSolverAddress should match to systemCredentials.login.email of any user othewise attribute 'assignedTo' is not resolved.

			@method handleRequestCreated

		*/
		this.handleRequestCreated=function(event, collection){

			var entity = event.entity;
			var solverAddress=this.ctx.config.mails.requestSolverAddress;

			var requestsDao = new universalDaoModule.UniversalDao(
			this.ctx.mongoDriver,
			{collectionName: collection}
			);
			
			// console.log('mmmmmmmmmmmmmm: ' + JSON.stringify(event));

			if(!entity.requestData){
				entity.requestData = {};
			}
			entity.requestData.setupDate=dateUtils.nowToReverse();
			entity.requestData.status='created';
			entity.requestData.applicant={schema:"uri://registries/people#views/fullperson-km/view",registry:'people',oid:event.user.id};

			if (event.user && event.user.officer && event.user.officer.club) {
				entity.requestData.clubApplicant = {
					schema: "uri://registries/organizations#views/club-km/view",
					oid: event.user.officer.club.oid
				};
			} else {
				log.warn('Applicant %s does not have assigned club as officer but should have', event.user.id);
			}
				
			var qf=QueryFilter.create();
			qf.addCriterium("systemCredentials.login.email","eq",solverAddress);

			userDao.find(qf, function(err, data) {
				if (err){
					log.error(err);
					return;
				}

				// assign to and send mail.
				if (data.length==1){
					var solver=data[0];
					entity.requestData.assignedTo={schema:"uri://registries/people#views/fullperson-km/view",registry:'people',oid:solver.id};
				}
				self.sendRequestCreated(solverAddress,self.ctx.config.webserverPublicUrl,event.user.baseData.name.v+' '+event.user.baseData.surName.v,entity.requestData.subject,self.ctx.config.serviceUrl+'/requests/'+entity.id);
				
				requestsDao.save(entity,function(err,data){
					if (err) {
						log.error(err);
						return;
					}
					log.debug('requests created: event handled');
				});
			});
			

			

		};

		/**
			Method handles <b>event-request-updated</b>
			@method handleRequestModified
		*/
		this.handleRequestModified=function(event){

			var entity = event.entity;
			// var solverAddress=this.ctx.config.mails.requestSolverAddress;

			// if (entity.requestData) {

			entity.requestData.applicant={schema:"uri://registries/people#views/fullperson/view",registry:'people',oid:event.user.id};
			var solverAddress=self.ctx.config.mails.requestSolverAddress;

				if (entity.requestData.assignedTo){
					userDao.get(entity.requestData.assignedTo.oid, function(err, solver) {
						if (err){
							log.error(err);
							return;
						}

						// assign to and send mail.
						if (solver){
							self.sendRequestModified(solver.systemCredentials.login.email,self.ctx.config.webserverPublicUrl,event.user.baseData.name.v+' '+event.user.baseData.surName.v,entity.requestData.subject,self.ctx.config.serviceUrl+'/requests/'+entity.id);
						}
					});

				} else {
					self.sendRequestModified(this.ctx.config.mails.requestSolverAddress,self.ctx.config.webserverPublicUrl,event.user.baseData.name.v+' '+event.user.baseData.surName.v,entity.requestData.subject,self.ctx.config.serviceUrl+'/requests/'+entity.id);
				}

				if (entity.requestData.applicant){
					userDao.get(entity.requestData.applicant.oid,function(err,applicant){
						if (err){
							log.error(err);
							return;
						}
						self.sendRequestModified(applicant.systemCredentials.login.email,self.ctx.config.webserverPublicUrl,event.user.baseData.name.v+' '+event.user.baseData.surName.v,entity.requestData.subject,self.ctx.config.serviceUrl+'/requests/'+entity.id);
					});
				}
			// }
		}


		this.sendRequestCreated=function(email,serviceUrl,applicant,subject,requestUri){

			var mailOptions = {
				from : 'websupport@unionsoft.sk',
				to : email,
				subject : '['+serviceUrl+'] Nová žiadosť',
				html : renderService.render(renderModule.templates.REQUEST_CREATED_HTML,{applicant:applicant,subject:subject,serviceUrl:serviceUrl,requestUri:requestUri})
			};

			log.verbose('Sending mail ', mailOptions);

			transport.sendMail(mailOptions);


		};
		this.sendRequestModified=function(email,serviceUrl,modifier,subject,requestUri){

			var mailOptions = {
				from : 'websupport@unionsoft.sk',
				to : email,
				subject : '['+serviceUrl+'] Upravená žiadosť',
				html : renderService.render(renderModule.templates.REQUEST_UPDATED_HTML,{modifier:modifier,subject:subject,serviceUrl:serviceUrl,requestUri:requestUri})
			};

			log.verbose('Sending mail ', mailOptions);

			transport.sendMail(mailOptions);


		};

	}
	/**
	* method dispatch all types of registered events to actual handling method.
	* @method handle
	*/
	RequestChangedHandler.prototype.handle = function(event) {
		log.info('handle called',event,RequestChangedHandler.prototype.ctx);

		if ('event-general-request-created' === event.eventType){
			this.handleRequestCreated(event, GEN_REQ_COLLECTION);
		}else if('event-registration-request-created' === event.eventType){
			this.handleRequestCreated(event, REG_REQ_COLLECTION);
		}else if('event-data-request-created' === event.eventType){
			this.handleRequestCreated(event, DATA_REQ_COLLECTION);
		}else if('event-transfer-request-created' === event.eventType){
			this.handleRequestCreated(event, TRANS_REQ_COLLECTION);
		}else if ('event-general-request-updated' === event.eventType){
			this.handleRequestModified(event, GEN_REQ_COLLECTION);
		}else if('event-registration-request-updated' === event.eventType){
			this.handleRequestModified(event, REG_REQ_COLLECTION);
		}else if('event-data-request-updated' === event.eventType){
			this.handleRequestModified(event, DATA_REQ_COLLECTION)
		}else if('event-transfer-request-updated' === event.eventType){
			this.handleRequestModified(event, TRANS_REQ_COLLECTION);
		}
	};

	RequestChangedHandler.prototype.getType=function(){
		return ["event-general-request-created","event-registration-request-created","event-data-request-created", "event-transfer-request-created",
				"event-general-request-updated","event-registration-request-updated","event-data-request-updated", "event-transfer-request-updated"];
	};

	module.exports = function( ctx) {
		return new RequestChangedHandler(ctx );
	};
}());
